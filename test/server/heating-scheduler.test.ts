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
  let current = status({ connected: options.connected !== false });
  const spa: SpaAdapter = {
    getStatus: async () => current,
    setTargetTemperature: async value => {
      calls.target.push(value);
      current = { ...current, targetTemperatureC: value, updatedAt: Date.now() };
      return current;
    },
    setHeater: async on => {
      calls.heater += 1;
      if (options.failHeater) throw new Error('heater command failed');
      current = { ...current, heaterOn: on, updatedAt: Date.now() };
      return current;
    },
    setFilter: async on => {
      current = { ...current, filterOn: on, updatedAt: Date.now() };
      return current;
    },
    setBubbles: async on => {
      current = { ...current, bubblesOn: on, updatedAt: Date.now() };
      return current;
    }
  };
  return {
    spa,
    calls,
    setStatus: (patch: Partial<SpaStatus>) => {
      current = { ...current, ...patch, updatedAt: Date.now() };
    }
  };
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

test('target reached and heat soak complete alerts follow actual temperature, even before target time', async () => {
  await withStore(async store => {
    const { spa, setStatus } = adapter();
    const scheduler = new HeatingScheduler(spa, store);
    const now = Date.now();
    const schedule = await scheduler.createSchedule({
      startTime: now + 60_000,
      targetTime: now + 3_600_000,
      startTemperatureC: 30,
      targetTemperatureC: 39,
      autoStartPreferred: true,
      heatSoakMinutes: 10,
      alertOnTargetReached: true,
      alertOnHeatSoakComplete: true
    });

    await scheduler.processDue(now + 60_000);
    setStatus({ waterTemperatureC: 39 });
    const reachedAt = now + 120_000;
    await scheduler.processDue(reachedAt);

    let saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.targetReachedAt, reachedAt);
    assert.equal(saved.soakStartedAt, reachedAt);
    assert.ok(reachedAt < schedule.targetTime);
    let kinds = (await scheduler.listNotifications()).map(item => item.kind);
    assert.ok(kinds.includes('target_reached'));
    assert.ok(!kinds.includes('heat_soak_complete'));

    await scheduler.processDue(reachedAt + (9 * 60_000));
    saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.status, 'running-remote');

    const readyAt = reachedAt + (10 * 60_000);
    await scheduler.processDue(readyAt);
    saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.status, 'ready');
    assert.equal(saved.heatSoakCompletedAt, readyAt);
    kinds = (await scheduler.listNotifications()).map(item => item.kind);
    assert.ok(kinds.includes('heat_soak_complete'));
  });
});

test('heat soak restarts after a meaningful temperature drop', async () => {
  await withStore(async store => {
    const { spa, setStatus } = adapter();
    const scheduler = new HeatingScheduler(spa, store);
    const now = Date.now();
    const schedule = await scheduler.createSchedule({
      startTime: now + 60_000,
      targetTime: now + 3_600_000,
      startTemperatureC: 30,
      targetTemperatureC: 39,
      autoStartPreferred: true,
      heatSoakMinutes: 10
    });

    await scheduler.processDue(now + 60_000);
    setStatus({ waterTemperatureC: 39 });
    const reachedAt = now + 120_000;
    await scheduler.processDue(reachedAt);

    setStatus({ waterTemperatureC: 38.4 });
    await scheduler.processDue(reachedAt + (5 * 60_000));
    let saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.soakStartedAt, undefined);

    setStatus({ waterTemperatureC: 38.6 });
    const restartedAt = reachedAt + (6 * 60_000);
    await scheduler.processDue(restartedAt);
    saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.soakStartedAt, restartedAt);

    await scheduler.processDue(restartedAt + (9 * 60_000));
    saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.status, 'running-remote');

    await scheduler.processDue(restartedAt + (10 * 60_000));
    saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.status, 'ready');
  });
});

test('alert settings do not disable target and soak tracking', async () => {
  await withStore(async store => {
    const { spa, setStatus } = adapter();
    const scheduler = new HeatingScheduler(spa, store);
    const now = Date.now();
    const schedule = await scheduler.createSchedule({
      startTime: now + 60_000,
      targetTime: now + 3_600_000,
      startTemperatureC: 30,
      targetTemperatureC: 39,
      autoStartPreferred: true,
      heatSoakMinutes: 0,
      alertOnTargetReached: false,
      alertOnHeatSoakComplete: false
    });

    await scheduler.processDue(now + 60_000);
    setStatus({ waterTemperatureC: 39 });
    await scheduler.processDue(now + 120_000);

    const saved = (await scheduler.listSchedules()).find(item => item.id === schedule.id)!;
    assert.equal(saved.status, 'ready');
    assert.ok(saved.targetReachedAt);
    assert.ok(saved.heatSoakCompletedAt);
    const kinds = (await scheduler.listNotifications()).map(item => item.kind);
    assert.deepEqual(kinds, ['heater_started']);
  });
});
