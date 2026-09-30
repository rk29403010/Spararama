import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';
import { TelemetryCollector } from '../../server/telemetry/collector';
import { LocalTelemetryStore } from '../../server/telemetry/local-store';

function status(superheat: boolean): SpaStatus {
  return {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 40,
    targetTemperatureC: 40,
    heaterOn: false,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 100,
    heaterRuntimeSeconds: 50,
    faults: { filterOverdue: false, superheat, undercooling: false },
    updatedAt: Date.now(),
    lastContactAt: Date.now(),
    contactFailureCount: 0
  };
}

class DummySpa implements SpaAdapter {
  async getStatus() { return status(false); }
  async setHeater() { return status(false); }
  async setFilter() { return status(false); }
  async setBubbles() { return status(false); }
  async setTargetTemperature() { return status(false); }
}

const disabledSink = {
  enabled: false,
  async writeSamples() {}
};

test('fault-only transitions create sparse telemetry events without duplicate active samples', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-fault-telemetry-'));
  try {
    const store = new LocalTelemetryStore(dir);
    const collector = new TelemetryCollector(new DummySpa(), store, disabledSink);

    await collector.collectNow(status(false));
    await collector.collectNow(status(true));
    await collector.collectNow(status(true));
    await collector.collectNow(status(false));

    const records = await store.readPending();
    assert.equal(records.length, 3);

    const started = records[1];
    assert.equal(started.schemaVersion, 2);
    if (started.schemaVersion !== 2) throw new Error('Expected v2 event');
    assert.equal(started.recordKind, 'change');
    assert.deepEqual(started.changedFields, ['spa.faults.superheat']);
    assert.deepEqual(started.spa, {
      faults: { filterOverdue: false, superheat: true, undercooling: false }
    });

    const cleared = records[2];
    assert.equal(cleared.schemaVersion, 2);
    if (cleared.schemaVersion !== 2) throw new Error('Expected v2 event');
    assert.deepEqual(cleared.changedFields, ['spa.faults.superheat']);
    assert.deepEqual(cleared.spa, {
      faults: { filterOverdue: false, superheat: false, undercooling: false }
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
