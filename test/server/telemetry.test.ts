import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalTelemetryStore } from '../../server/telemetry/local-store';
import { TelemetryCollector } from '../../server/telemetry/collector';
import { resolveFirebaseTelemetryConfig } from '../../server/telemetry/firebase-sink';
import { TelemetrySettingsStore, validateTelemetryIntervalSeconds } from '../../server/telemetry/settings';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';
import type { StoredTelemetryRecord, TelemetrySample } from '../../server/telemetry/types';

function fixedStatus(overrides: Partial<SpaStatus> = {}): SpaStatus {
  return {
    transport: 'lan', connected: true, waterTemperatureC: 31.5, targetTemperatureC: 38,
    heaterOn: true, filterOn: true, bubblesOn: false,
    filterRuntimeSeconds: 100, heaterRuntimeSeconds: 50, updatedAt: Date.now(),
    ...overrides
  };
}

class FixedSpa implements SpaAdapter {
  async getStatus(): Promise<SpaStatus> { return fixedStatus(); }
  async setHeater() { return this.getStatus(); }
  async setFilter() { return this.getStatus(); }
  async setBubbles() { return this.getStatus(); }
  async setTargetTemperature() { return this.getStatus(); }
}

class MutableSpa implements SpaAdapter {
  status = fixedStatus();
  async getStatus(): Promise<SpaStatus> { return { ...this.status, updatedAt: Date.now() }; }
  async setHeater(on: boolean) { this.status.heaterOn = on; return this.getStatus(); }
  async setFilter(on: boolean) { this.status.filterOn = on; return this.getStatus(); }
  async setBubbles(on: boolean) { this.status.bubblesOn = on; return this.getStatus(); }
  async setTargetTemperature(celsius: number) { this.status.targetTemperatureC = celsius; return this.getStatus(); }
}

class FailingSink {
  enabled = true;
  async writeSamples(_samples: StoredTelemetryRecord[]) { throw new Error('offline'); }
}

class RecordingSink {
  enabled = true;
  samples: StoredTelemetryRecord[] = [];
  async writeSamples(samples: StoredTelemetryRecord[]) { this.samples.push(...samples); }
}

class DisabledSink {
  enabled = false;
  async writeSamples(_samples: StoredTelemetryRecord[]) {}
}

test('Firebase telemetry defaults resolve the intended project and named database', () => {
  const originalProject = process.env.FIREBASE_PROJECT_ID;
  const originalDatabase = process.env.FIRESTORE_DATABASE_ID;
  try {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIRESTORE_DATABASE_ID;
    const config = resolveFirebaseTelemetryConfig();
    assert.equal(config.projectId, 'microprojects-481213');
    assert.equal(config.databaseId, 'ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65');
  } finally {
    if (originalProject === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = originalProject;
    if (originalDatabase === undefined) delete process.env.FIRESTORE_DATABASE_ID;
    else process.env.FIRESTORE_DATABASE_ID = originalDatabase;
  }
});

function sample(id: string, overrides: Partial<SpaStatus> = {}, timestamp = Date.now()): TelemetrySample {
  return {
    schemaVersion: 1,
    id,
    timestamp,
    hostId: 'test-host',
    collectorVersion: 'test',
    spa: fixedStatus(overrides),
    changedFields: [], sensors: [], weather: []
  };
}

test('telemetry is archived locally and remains queued when cloud upload fails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    const collector = new TelemetryCollector(new FixedSpa(), store, new FailingSink());
    await collector.collectNow();

    const pending = await store.readPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].schemaVersion, 2);
    assert.equal(pending[0].spa?.waterTemperatureC, 31.5);
    assert.equal(collector.getStatus().pendingUploads, 1);
    const archive = await fs.readFile(store.archivePath, 'utf8');
    assert.match(archive, /31\.5/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('unchanged polling does not append duplicate telemetry records', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    const collector = new TelemetryCollector(new FixedSpa(), store, new DisabledSink());
    await collector.collectNow();
    await collector.collectNow();
    await collector.collectNow();
    assert.equal((await store.readPending()).length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a temperature change creates one sparse event and history reconstructs full state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    const spa = new MutableSpa();
    const collector = new TelemetryCollector(spa, store, new DisabledSink());
    await collector.collectNow();
    spa.status.waterTemperatureC = 32.5;
    spa.status.filterRuntimeSeconds += 300;
    spa.status.heaterRuntimeSeconds += 300;
    await collector.collectNow();

    const records = await store.readPending();
    assert.equal(records.length, 2);
    assert.equal(records[1].schemaVersion, 2);
    if (records[1].schemaVersion !== 2) throw new Error('Expected v2 event');
    assert.equal(records[1].recordKind, 'change');
    assert.deepEqual(records[1].spa, { waterTemperatureC: 32.5 });
    assert.deepEqual(records[1].changedFields, ['spa.waterTemperatureC']);

    const history = await store.readRecent(10);
    assert.equal(history.samples[0].spa.waterTemperatureC, 32.5);
    assert.equal(history.samples[0].spa.targetTemperatureC, 38);
    assert.equal(history.samples[0].spa.heaterOn, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('successful retry empties pending queue but preserves local archive', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    const failing = new TelemetryCollector(new FixedSpa(), store, new FailingSink());
    await failing.collectNow();
    assert.equal((await store.readPending()).length, 1);

    const sink = new RecordingSink();
    const retry = new TelemetryCollector(new FixedSpa(), store, sink);
    await retry.flushPending();
    assert.equal(sink.samples.length, 1);
    assert.equal((await store.readPending()).length, 0);
    const archive = await fs.readFile(store.archivePath, 'utf8');
    assert.ok(archive.trim().length > 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('acknowledging an uploaded snapshot preserves samples appended during upload', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    await store.append(sample('first'));
    const uploadedSnapshot = await store.readPending();
    await store.append(sample('second'));
    await store.acknowledgePending(uploadedSnapshot.map(item => item.id));

    assert.deepEqual((await store.readPending()).map(item => item.id), ['second']);
    assert.equal((await fs.readFile(store.archivePath, 'utf8')).trim().split(/\r?\n/).length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('legacy v1 backlog compacts to snapshot plus meaningful changes and keeps backups', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    const started = Date.now();
    await store.append(sample('first', {}, started));
    await store.append(sample('same', { filterRuntimeSeconds: 400, heaterRuntimeSeconds: 350 }, started + 5 * 60 * 1000));
    await store.append(sample('changed', { waterTemperatureC: 32.5, filterRuntimeSeconds: 700, heaterRuntimeSeconds: 650 }, started + 10 * 60 * 1000));

    const result = await store.compactLegacyTelemetry();
    assert.equal(result.archive.before, 3);
    assert.equal(result.archive.after, 2);
    assert.equal(result.pending.after, 2);
    assert.equal((await store.readPending()).length, 2);
    await fs.access(`${store.archivePath}.v1-backup`);
    await fs.access(`${store.pendingPath}.v1-backup`);

    const history = await store.readRecent(10);
    assert.equal(history.samples.length, 2);
    assert.equal(history.samples[0].spa.waterTemperatureC, 32.5);
    assert.equal(history.samples[1].spa.waterTemperatureC, 31.5);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('malformed pending data fails closed and remains intact', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(store.pendingPath, '{malformed}\n', 'utf8');
    await assert.rejects(store.readPending(), /Malformed telemetry queue entry at line 1/);
    assert.equal(await fs.readFile(store.pendingPath, 'utf8'), '{malformed}\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('recent telemetry history is newest-first, bounded, and leaves the archive intact', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    await store.append(sample('first'));
    await store.append(sample('second'));
    await store.append(sample('third'));
    const archiveBefore = await fs.readFile(store.archivePath, 'utf8');

    const history = await store.readRecent(2);

    assert.equal(history.total, 3);
    assert.deepEqual(history.samples.map(item => item.id), ['third', 'second']);
    assert.equal(await fs.readFile(store.archivePath, 'utf8'), archiveBefore);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('telemetry interval validation accepts five minutes and rejects unsafe values', () => {
  assert.equal(validateTelemetryIntervalSeconds(300), 300);
  assert.throws(() => validateTelemetryIntervalSeconds(30), /between 60 and 86400/);
  assert.throws(() => validateTelemetryIntervalSeconds(300.5), /whole number/);
});

test('telemetry settings persist independently of browser storage', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-settings-'));
  try {
    const settings = new TelemetrySettingsStore(dir);
    assert.equal((await settings.load()).intervalSeconds, 300);
    await settings.save({ intervalSeconds: 900 });
    assert.equal((await new TelemetrySettingsStore(dir).load()).intervalSeconds, 900);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
