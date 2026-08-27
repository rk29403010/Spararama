import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalTelemetryStore } from '../../server/telemetry/local-store';
import { SharedTelemetryStore, type RemoteTelemetryReadOptions } from '../../server/telemetry/shared-store';
import type { StoredTelemetryRecord, TelemetryEventRecord } from '../../server/telemetry/types';

function snapshot(hostId: string, id: string, timestamp: number, waterTemperatureC: number): TelemetryEventRecord {
  return {
    schemaVersion: 2,
    id,
    timestamp,
    hostId,
    collectorVersion: 'test',
    recordKind: 'snapshot',
    changedFields: ['initial'],
    spa: {
      transport: 'lan',
      connected: true,
      waterTemperatureC,
      targetTemperatureC: 38,
      heaterOn: true,
      filterOn: true,
      bubblesOn: false,
      filterRuntimeSeconds: 0,
      heaterRuntimeSeconds: 0,
      updatedAt: timestamp
    },
    sensors: [],
    weather: []
  };
}

function temperatureChange(hostId: string, id: string, timestamp: number, waterTemperatureC: number): TelemetryEventRecord {
  return {
    schemaVersion: 2,
    id,
    timestamp,
    hostId,
    collectorVersion: 'test',
    recordKind: 'change',
    changedFields: ['spa.waterTemperatureC'],
    spa: { waterTemperatureC }
  };
}

function cloudRecord(record: StoredTelemetryRecord, writtenAt: number): StoredTelemetryRecord {
  return { ...record, _firebaseWrittenAt: writtenAt } as unknown as StoredTelemetryRecord;
}

class FixedRemote {
  enabled = true;
  constructor(private readonly records: StoredTelemetryRecord[]) {}
  async readSamples() { return this.records; }
}

class FailingRemote {
  enabled = true;
  async readSamples(): Promise<StoredTelemetryRecord[]> { throw new Error('offline'); }
}

class DisabledRemote {
  enabled = false;
}

class IncrementalRemote {
  enabled = true;
  calls: RemoteTelemetryReadOptions[] = [];
  async readSamples(options: RemoteTelemetryReadOptions = {}) {
    this.calls.push(options);
    if (this.calls.length === 1) {
      return {
        records: [cloudRecord(snapshot('phone', 'phone-1', 1000, 32), 100)],
        collectorIds: ['phone'],
        cursor: 100
      };
    }
    return {
      records: [cloudRecord(temperatureChange('phone', 'phone-2', 2000, 33), 200)],
      collectorIds: ['phone'],
      cursor: 200
    };
  }
}

test('shared telemetry merges local and Firebase collectors without cross-contaminating state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-shared-'));
  try {
    const local = new LocalTelemetryStore(dir);
    await local.append(snapshot('laptop', 'local-1', 2000, 35));

    const remoteRecords: StoredTelemetryRecord[] = [
      snapshot('phone', 'phone-1', 1000, 32),
      temperatureChange('phone', 'phone-2', 3000, 33),
      // Same logical record as local: merge should de-duplicate it by host + id.
      snapshot('laptop', 'local-1', 2000, 35)
    ];
    const shared = new SharedTelemetryStore(local, new FixedRemote(remoteRecords));
    const history = await shared.readRecent(10);

    assert.equal(history.total, 3);
    assert.deepEqual(history.samples.map(sample => sample.id), ['phone-2', 'local-1', 'phone-1']);
    const changed = history.samples.find(sample => sample.id === 'phone-2');
    assert.equal(changed?.spa.waterTemperatureC, 33);
    assert.equal(changed?.spa.targetTemperatureC, 38);
    const laptop = history.samples.find(sample => sample.id === 'local-1');
    assert.equal(laptop?.spa.waterTemperatureC, 35);
    assert.equal(history.sharedHistory.source, 'firebase');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('shared telemetry advances a cloud-write cursor and merges incremental changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-shared-incremental-'));
  try {
    const local = new LocalTelemetryStore(dir);
    const remote = new IncrementalRemote();
    const shared = new SharedTelemetryStore(local, remote);
    await shared.refresh();
    await shared.refresh();

    assert.equal(remote.calls.length, 2);
    assert.equal(remote.calls[0].writtenAfter, 0);
    assert.deepEqual(remote.calls[0].knownHosts, []);
    assert.equal(remote.calls[1].writtenAfter, 100);
    assert.deepEqual(remote.calls[1].knownHosts, ['phone']);

    const history = await shared.readRecent(10);
    assert.equal(history.total, 2);
    assert.equal(history.samples[0].id, 'phone-2');
    assert.equal(history.samples[0].spa.waterTemperatureC, 33);
    assert.equal(history.samples[0].spa.targetTemperatureC, 38);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('shared telemetry falls back to cached Firebase history when cloud read fails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-shared-cache-'));
  try {
    const local = new LocalTelemetryStore(dir);
    const remoteRecord = snapshot('phone', 'phone-1', 1000, 32);
    const online = new SharedTelemetryStore(local, new FixedRemote([remoteRecord]));
    await online.refresh();
    await fs.access(local.remoteCachePath);

    const offline = new SharedTelemetryStore(local, new FailingRemote());
    const history = await offline.readRecent(10);
    assert.equal(history.total, 1);
    assert.equal(history.samples[0].id, 'phone-1');
    assert.equal(history.sharedHistory.source, 'cache');
    assert.match(history.sharedHistory.lastError || '', /offline/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('shared telemetry remains local-only when Firebase is disabled and no cache exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-shared-local-'));
  try {
    const local = new LocalTelemetryStore(dir);
    await local.append(snapshot('laptop', 'local-1', 1000, 30));
    const shared = new SharedTelemetryStore(local, new DisabledRemote());
    const history = await shared.readRecent(10);
    assert.equal(history.total, 1);
    assert.equal(history.samples[0].id, 'local-1');
    assert.equal(history.sharedHistory.source, 'local-only');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
