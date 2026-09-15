import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';
import { TelemetryCollector } from '../../server/telemetry/collector';
import { LocalTelemetryStore } from '../../server/telemetry/local-store';
import type { StoredTelemetryRecord } from '../../server/telemetry/types';

function pushedStatus(): SpaStatus {
  return {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 32,
    targetTemperatureC: 39,
    heaterOn: false,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 120,
    heaterRuntimeSeconds: 0,
    updatedAt: Date.now()
  };
}

class NoReadSpa implements SpaAdapter {
  reads = 0;

  async getStatus(): Promise<SpaStatus> {
    this.reads += 1;
    throw new Error('pushed telemetry must not re-read the spa');
  }

  async setHeater(_on: boolean) { return pushedStatus(); }
  async setFilter(_on: boolean) { return pushedStatus(); }
  async setBubbles(_on: boolean) { return pushedStatus(); }
  async setTargetTemperature(_celsius: number) { return pushedStatus(); }
}

class DisabledSink {
  enabled = false;
  async writeSamples(_samples: StoredTelemetryRecord[]) {}
}

test('pushed spa telemetry is stored without reading the spa again', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-telemetry-push-'));
  try {
    const spa = new NoReadSpa();
    const store = new LocalTelemetryStore(dir);
    const collector = new TelemetryCollector(spa, store, new DisabledSink());

    await collector.collectNow(pushedStatus());

    assert.equal(spa.reads, 0);
    const pending = await store.readPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].spa?.waterTemperatureC, 32);
    assert.equal(pending[0].spa?.filterOn, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
