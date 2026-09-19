import assert from 'node:assert/strict';
import test from 'node:test';
import { HeatingPlanner } from '../../server/heating/planner';
import type { HeatingSchedule } from '../../server/heating/types';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';

function spaStatus(overrides: Partial<SpaStatus> = {}): SpaStatus {
  return {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 30,
    targetTemperatureC: 40,
    heaterOn: false,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0,
    updatedAt: Date.now(),
    ...overrides
  };
}

function spa(initial: SpaStatus): SpaAdapter {
  let current = initial;
  return {
    getStatus: async () => current,
    setHeater: async on => (current = { ...current, heaterOn: on }),
    setFilter: async on => (current = { ...current, filterOn: on }),
    setBubbles: async on => (current = { ...current, bubblesOn: on }),
    setTargetTemperature: async value => (current = { ...current, targetTemperatureC: value })
  };
}

function schedule(overrides: Partial<HeatingSchedule> = {}): HeatingSchedule {
  const now = 1_700_000_000_000;
  return {
    id: 'heat-1',
    createdAt: now,
    updatedAt: now,
    startTime: now + 60_000,
    targetTime: now + (3 * 60 * 60_000),
    startTemperatureC: 30,
    targetTemperatureC: 40,
    autoStartPreferred: true,
    heatSoakMinutes: 0,
    alertOnTargetReached: true,
    alertOnHeatSoakComplete: true,
    status: 'scheduled',
    attempts: 0,
    ...overrides
  };
}

function schedules(items: HeatingSchedule[]) {
  return { listSchedules: async () => items };
}

const model = {
  baseHeatingRateCPerHour: 2,
  waterVolumeLiters: 800,
  referenceVolumeLiters: 800,
  heatSoakMinutes: 0,
  heaterPowerWatts: 1800,
  electricityRatePerKwh: 0.2
};

test('heater-off outlook keeps requested bathing time but estimates as if heating starts now', async () => {
  const now = 1_700_000_000_000;
  const request = schedule({ targetTime: now + (3 * 60 * 60_000) });
  const planner = new HeatingPlanner(spa(spaStatus({ heaterOn: false })), schedules([request]), undefined, model);

  const outlook = await planner.getOutlook(now);

  assert.equal(outlook.requestedBathingTime, request.targetTime);
  assert.equal(outlook.requestedScheduleId, request.id);
  assert.equal(outlook.scenario, 'assume-start-now');
  assert.equal(outlook.estimatedBathingTime, now + (5 * 60 * 60_000));
  assert.equal(outlook.projection?.hoursToHeat, 5);
});

test('heater-on outlook keeps a missed requested time visible while projecting the later ready time', async () => {
  const now = 1_700_000_000_000;
  const request = schedule({
    status: 'running-remote',
    targetTime: now - (10 * 60_000),
    createdAt: now - (4 * 60 * 60_000)
  });
  const planner = new HeatingPlanner(spa(spaStatus({ heaterOn: true })), schedules([request]), undefined, model);

  const outlook = await planner.getOutlook(now);

  assert.equal(outlook.requestedBathingTime, request.targetTime);
  assert.equal(outlook.scenario, 'continue-heating');
  assert.equal(outlook.estimatedBathingTime, now + (5 * 60 * 60_000));
});

test('heater-on outlook uses remaining soak time instead of restarting the whole soak', async () => {
  const now = 1_700_000_000_000;
  const request = schedule({
    status: 'running-remote',
    heatSoakMinutes: 30,
    targetReachedAt: now - (10 * 60_000),
    soakStartedAt: now - (10 * 60_000)
  });
  const planner = new HeatingPlanner(
    spa(spaStatus({ waterTemperatureC: 40, targetTemperatureC: 40, heaterOn: true })),
    schedules([request]),
    undefined,
    { ...model, heatSoakMinutes: 30 }
  );

  const outlook = await planner.getOutlook(now);

  assert.equal(outlook.scenario, 'continue-heating');
  assert.equal(outlook.projection?.heatSoakMinutes, 20);
  assert.equal(outlook.estimatedBathingTime, now + (20 * 60_000));
});

test('outlook omits requested bathing time when no future or active heating request exists', async () => {
  const now = 1_700_000_000_000;
  const completed = schedule({
    status: 'ready',
    targetTime: now - 60_000,
    heatSoakCompletedAt: now - 60_000
  });
  const planner = new HeatingPlanner(spa(spaStatus()), schedules([completed]), undefined, model);

  const outlook = await planner.getOutlook(now);

  assert.equal(outlook.requestedBathingTime, undefined);
  assert.equal(outlook.requestedScheduleId, undefined);
  assert.equal(outlook.estimatedBathingTime, now + (5 * 60 * 60_000));
});

test('outlook preserves the requested bathing time when live spa data is unavailable', async () => {
  const now = 1_700_000_000_000;
  const request = schedule({ targetTime: now + (3 * 60 * 60_000) });
  const planner = new HeatingPlanner(
    spa(spaStatus({ connected: false })),
    schedules([request]),
    undefined,
    model
  );

  const outlook = await planner.getOutlook(now);

  assert.equal(outlook.requestedBathingTime, request.targetTime);
  assert.equal(outlook.estimatedBathingTime, undefined);
  assert.equal(outlook.scenario, 'unavailable');
  assert.match(outlook.unavailableReason || '', /live water temperature/i);
});


test('provider-neutral ready-at scheduling uses the shared model and normal scheduler boundary', async () => {
  const now = 1_700_000_000_000;
  const created: any[] = [];
  const source = {
    listSchedules: async () => [] as HeatingSchedule[],
    createSchedule: async (input: any) => {
      created.push(input);
      return { ...input, id: 'ready-at-1', status: 'scheduled' };
    }
  };
  const planner = new HeatingPlanner(
    spa(spaStatus({ waterTemperatureC: 35, targetTemperatureC: 39, connected: true, transport: 'lan' })),
    source,
    undefined,
    { ...model, heatSoakMinutes: 30 }
  );

  const result = await planner.scheduleReadyAt({
    targetTime: now + (4 * 60 * 60_000),
    sessionData: { source: 'test' }
  }, now);

  assert.equal(created.length, 1);
  assert.equal(created[0].targetTemperatureC, 39);
  assert.equal(created[0].autoStartPreferred, true);
  assert.equal(created[0].heatSoakMinutes, 30);
  assert.equal(created[0].sessionData.source, 'test');
  assert.equal(created[0].sessionData.estimation, 'shared-heating-model');
  assert.equal(result.targetTime, now + (4 * 60 * 60_000));
  assert.equal(result.targetTemperatureC, 39);
  assert.equal(result.weatherAdjusted, false);
});
