import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalTelemetryStore } from '../../server/telemetry/local-store';
import { TelemetryCollector } from '../../server/telemetry/collector';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';
import type { TelemetrySample } from '../../server/telemetry/types';

class FixedSpa implements SpaAdapter {
  async getStatus(): Promise<SpaStatus> {
    return {
      transport: 'lan', connected: true, waterTemperatureC: 31.5, targetTemperatureC: 38,
      heaterOn: true, filterOn: true, bubblesOn: false,
      filterRuntimeSeconds: 100, heaterRuntimeSeconds: 50, updatedAt: Date.now()
    };
  }
  async setHeater() { return this.getStatus(); }
  async setFilter() { return this.getStatus(); }
  async setBubbles() { return this.getStatus(); }
  async setTargetTemperature() { return this.getStatus(); }
}

class FailingSink {
  enabled = true;
  async writeSamples(_samples: TelemetrySample[]) {
    throw new Error('offline');
  }
}

class RecordingSink {
  enabled = true;
  samples: TelemetrySample[] = [];
  async writeSamples(samples: TelemetrySample[]) {
    this.samples.push(...samples);
  }
}

test('telemetry is archived locally and remains queued when cloud upload fails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    const collector = new TelemetryCollector(new FixedSpa(), store, new FailingSink());
    await collector.collectNow();

    const pending = await store.readPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].spa.waterTemperatureC, 31.5);
    assert.equal(collector.getStatus().pendingUploads, 1);
    const archive = await fs.readFile(store.archivePath, 'utf8');
    assert.match(archive, /31\.5/);
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
