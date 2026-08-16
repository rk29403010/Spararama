import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HeatingScheduler } from '../../server/heating/scheduler';
import { HeatingStore } from '../../server/heating/store';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';

function status(overrides: Partial<SpaStatus> = {}): SpaStatus {
  return {
    transport: 'lan', connected: true, waterTemperatureC: 30, targetTemperatureC: 40,
    heaterOn: false, filterOn: true, bubblesOn: false, filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0, updatedAt: Date.now(), ...overrides
  };
}

async function withStore(run: (store: HeatingStore) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-heating-'));
  try { await run(new HeatingStore(dir)); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

function adapter(options: { connected?: boolean; failHeater?: boolean } = {}) {
  const calls = { target: [] as number[], heater: 0 };
  const base = status({ connected: options.connected !== false });
  const spa: SpaAdapter = {
    getStatus: async () => base,
    setTargetTemperature: async value => { calls.target.push(value); return { ...base, targetTemperatureC: value }; },
    setHeater: async on => {
      calls.heater += 1;
      if (options.failHeater) throw new Error('heater command failed');
      return { ...base, heaterOn: on };
    },
    setFilter: async on => ({ ...base, filterOn: on }),
    setBubbles: async on => ({ ...base, bubblesOn: on })
  };
  return { spa, calls };
}

test('connected schedule starts remotely without a manual start notification', async () => {
  await withStore(async store => {
    const { spa, calls } = adapter();
    const scheduler = new HeatingScheduler(spa, store);
    const now = Date.now();
    const schedule = await scheduler.createSchedule({ startTime: now + 60_000, targetTime: now + 3_600_000, startTemperatureC: 30, targetTemperatureC: 39, autoStartPreferred: true });
    await scheduler.processDue(now + 60_000);

    const saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.status, 'running-remote');
    assert.deepEqual(calls.target, [39]);
    assert.equal(calls.heater, 1);
    const notices = await scheduler.listNotifications();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].kind, 'heater_started');
  });
});

test('remote failure gets two retries then requests manual start', async () => {
  await withStore(async store => {
    const { spa } = adapter({ connected: false });
    const scheduler = new HeatingScheduler(spa, store);
    const now = Date.now();
    const schedule = await scheduler.createSchedule({ startTime: now + 60_000, targetTime: now + 3_600_000, startTemperatureC: 30, targetTemperatureC: 39, autoStartPreferred: true });

    await scheduler.processDue(now + 60_000);
    await scheduler.processDue(now + 80_000);
    await scheduler.processDue(now + 100_000);

    const saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.attempts, 3);
    assert.equal(saved.status, 'awaiting-manual-confirmation');
    const notices = await scheduler.listNotifications();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].kind, 'manual_start_required');
    assert.equal(notices[0].requiresConfirmation, true);
  });
});

test('manual confirmation records the actual confirmation time and resolves prompt', async () => {
  await withStore(async store => {
    const { spa } = adapter();
    const scheduler = new HeatingScheduler(spa, store);
    const now = Date.now();
    const schedule = await scheduler.createSchedule({ startTime: now + 60_000, targetTime: now + 3_600_000, startTemperatureC: 30, targetTemperatureC: 39, autoStartPreferred: false });
    await scheduler.processDue(now + 60_000);
    assert.equal((await scheduler.listNotifications()).length, 1);

    const confirmed = await scheduler.confirmManualStart(schedule.id);
    assert.equal(confirmed.status, 'running-manual');
    assert.ok(confirmed.manualStartedAt);
    assert.equal((await scheduler.listNotifications()).length, 0);
  });
});
