import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SpaHealthMonitor, type SpaHealthAlertSuppressionSource } from '../../server/health/spa-health-monitor';
import { NotificationService } from '../../server/notifications/service';
import { NotificationStore } from '../../server/notifications/store';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';

function spaStatus(overrides: Partial<SpaStatus> = {}): SpaStatus {
  return {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 30,
    targetTemperatureC: 40,
    heaterOn: false,
    filterOn: false,
    bubblesOn: false,
    filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0,
    updatedAt: 0,
    ...overrides
  };
}

async function withMonitor(run: (args: {
  monitor: SpaHealthMonitor;
  notifications: NotificationService;
  setStatus: (status: SpaStatus) => void;
  historyPath: string;
}) => Promise<void>, heating?: { listSchedules(): Promise<any[]> }, alertSuppression?: SpaHealthAlertSuppressionSource) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-spa-health-'));
  const historyPath = path.join(dir, 'spa-events.jsonl');
  const previousHistoryPath = process.env.SPA_HISTORY_FILE;
  process.env.SPA_HISTORY_FILE = historyPath;
  try {
    let current = spaStatus();
    const spa: SpaAdapter = {
      getStatus: async () => current,
      setHeater: async () => current,
      setFilter: async () => current,
      setBubbles: async () => current,
      setTargetTemperature: async () => current
    };
    const notifications = new NotificationService(new NotificationStore(dir));
    const monitor = new SpaHealthMonitor(spa, notifications, heating, {
      offlineAfterMs: 180_000,
      staleAfterMs: 90_000,
      checkIntervalMs: 60_000,
      alertSuppression
    });
    await run({ monitor, notifications, setStatus: status => { current = status; }, historyPath });
  } finally {
    if (previousHistoryPath === undefined) delete process.env.SPA_HISTORY_FILE;
    else process.env.SPA_HISTORY_FILE = previousHistoryPath;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('spa health monitor ignores a short communication interruption', async () => {
  await withMonitor(async ({ monitor, notifications }) => {
    const started = 1_000_000;
    await monitor.observeStatus(spaStatus({ connected: true, lastContactAt: started }), started);
    await monitor.observeConnection(false, started + 1_000);
    await monitor.observeStatus(spaStatus({ connected: false, lastContactAt: started }), started + 120_000);

    assert.equal(monitor.getStatus().state, 'suspect');
    assert.equal((await notifications.listActive()).length, 0);
  });
});

test('spa health monitor opens and resolves one sustained offline incident', async () => {
  await withMonitor(async ({ monitor, notifications }) => {
    const started = 2_000_000;
    await monitor.observeStatus(spaStatus({ connected: true, lastContactAt: started }), started);
    await monitor.observeConnection(false, started + 1_000);
    await monitor.observeStatus(spaStatus({ connected: false, lastContactAt: started }), started + 180_000);

    let active = await notifications.listActive();
    assert.equal(monitor.getStatus().state, 'offline');
    assert.equal(active.length, 1);
    assert.equal(active[0].type, 'equipment.spa_offline');
    assert.equal(active[0].severity, 'warning');

    await monitor.observeStatus(spaStatus({ connected: true, lastContactAt: started + 240_000 }), started + 240_000);
    active = await notifications.listActive();
    assert.equal(monitor.getStatus().state, 'online');
    assert.equal(active.length, 0);
  });
});

test('spa health monitor escalates an outage when planned heating is due', async () => {
  const started = 3_000_000;
  const heating = {
    listSchedules: async () => [{
      id: 'schedule-1',
      createdAt: started,
      updatedAt: started,
      startTime: started + 60_000,
      targetTime: started + 600_000,
      startTemperatureC: 30,
      targetTemperatureC: 39,
      autoStartPreferred: true,
      heatSoakMinutes: 0,
      alertOnTargetReached: true,
      alertOnHeatSoakComplete: true,
      status: 'scheduled',
      attempts: 0
    }]
  };

  await withMonitor(async ({ monitor, notifications }) => {
    await monitor.observeStatus(spaStatus({ connected: true, lastContactAt: started }), started);
    await monitor.observeConnection(false, started + 1_000);
    await monitor.observeStatus(spaStatus({ connected: false, lastContactAt: started }), started + 180_000);

    const active = await notifications.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].severity, 'urgent');
    assert.match(active[0].title, /Heating cannot start/);
    assert.equal(active[0].context?.heatingScheduleId, 'schedule-1');
  }, heating);
});

test('planned maintenance keeps the offline incident but suppresses route delivery', async () => {
  let suppressed = true;
  const alertSuppression = { isOfflineAlertSuppressed: async () => suppressed };
  await withMonitor(async ({ monitor, notifications }) => {
    const started = 4_000_000;
    await monitor.observeStatus(spaStatus({ connected: true, lastContactAt: started }), started);
    await monitor.observeConnection(false, started + 1_000);
    await monitor.observeStatus(spaStatus({ connected: false, lastContactAt: started }), started + 180_000);

    let active = await notifications.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].deliverySuppressed, true);
    assert.equal(active[0].context?.deliverySuppressed, true);

    suppressed = false;
    await monitor.refreshAlertState(started + 181_000);
    active = await notifications.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].deliverySuppressed, undefined);
    assert.equal(active[0].context?.deliverySuppressed, false);
  }, undefined, alertSuppression);
});

test('spa diagnostic faults are logged once on each edge and resolved when they clear', async () => {
  await withMonitor(async ({ monitor, notifications, historyPath }) => {
    const started = 5_000_000;
    const noFaults = { filterOverdue: false, superheat: false, undercooling: false };
    await monitor.observeStatus(spaStatus({ connected: true, lastContactAt: started, faults: noFaults }), started);

    await monitor.observeStatus(spaStatus({
      connected: true,
      lastContactAt: started + 1_000,
      waterTemperatureC: 45,
      faults: { ...noFaults, superheat: true }
    }), started + 1_000);
    await monitor.observeStatus(spaStatus({
      connected: true,
      lastContactAt: started + 2_000,
      waterTemperatureC: 44,
      faults: { ...noFaults, superheat: true }
    }), started + 2_000);

    let active = await notifications.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].type, 'equipment.spa_superheat');
    assert.equal(active[0].severity, 'urgent');
    assert.equal(active[0].requiresAcknowledgement, true);

    let events = (await fs.readFile(historyPath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(events.length, 1, 'unchanged active fault must not create duplicate history events');
    assert.equal(events[0].type, 'fault');
    assert.equal(events[0].action, 'started');
    assert.equal(events[0].details.fault, 'superheat');
    assert.equal(events[0].details.water_temperature_c, 45);

    await monitor.observeStatus(spaStatus({
      connected: true,
      lastContactAt: started + 3_000,
      waterTemperatureC: 40,
      faults: noFaults
    }), started + 3_000);

    active = await notifications.listActive();
    assert.equal(active.length, 0);
    events = (await fs.readFile(historyPath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(events.length, 2);
    assert.equal(events[1].action, 'cleared');
    assert.equal(events[1].details.fault, 'superheat');
  });
});

test('an active diagnostic fault escalates when a bathing schedule becomes threatened', async () => {
  const started = 6_000_000;
  let schedules: any[] = [];
  const heating = { listSchedules: async () => schedules };

  await withMonitor(async ({ monitor, notifications }) => {
    const noFaults = { filterOverdue: false, superheat: false, undercooling: false };
    await monitor.observeStatus(spaStatus({ connected: true, lastContactAt: started, faults: noFaults }), started);
    await monitor.observeStatus(spaStatus({
      connected: true,
      lastContactAt: started + 1_000,
      faults: { ...noFaults, undercooling: true }
    }), started + 1_000);

    let active = await notifications.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].severity, 'warning');
    assert.equal(active[0].context?.bathingTimeAtRisk, undefined);

    schedules = [{
      id: 'schedule-fault-impact',
      createdAt: started,
      updatedAt: started,
      startTime: started + 2_000,
      targetTime: started + 300_000,
      startTemperatureC: 30,
      targetTemperatureC: 39,
      autoStartPreferred: true,
      heatSoakMinutes: 0,
      alertOnTargetReached: true,
      alertOnHeatSoakComplete: true,
      status: 'scheduled',
      attempts: 0
    }];

    await monitor.observeStatus(spaStatus({
      connected: true,
      lastContactAt: started + 3_000,
      faults: { ...noFaults, undercooling: true }
    }), started + 3_000);

    active = await notifications.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].severity, 'urgent');
    assert.match(active[0].title, /bath at risk/);
    assert.match(active[0].message, /ready time is at risk/);
    assert.equal(active[0].context?.heatingScheduleId, 'schedule-fault-impact');
    assert.equal(active[0].context?.bathingTimeAtRisk, true);
  }, heating);
});
