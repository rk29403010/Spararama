import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HeatingScheduler } from '../../server/heating/scheduler';
import { HeatingStore } from '../../server/heating/store';
import type { PublishNotificationInput } from '../../server/notifications/types';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';

function status(overrides: Partial<SpaStatus> = {}): SpaStatus {
  return {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 30,
    targetTemperatureC: 39,
    heaterOn: false,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0,
    updatedAt: Date.now(),
    ...overrides
  };
}

test('target-reached notification is warning severity so transient Push failures are retried', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-heating-routing-'));
  try {
    let current = status();
    const spa: SpaAdapter = {
      getStatus: async () => current,
      setTargetTemperature: async value => {
        current = { ...current, targetTemperatureC: value, updatedAt: Date.now() };
        return current;
      },
      setHeater: async on => {
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
    const published: PublishNotificationInput[] = [];
    const publisher = {
      publish: async (input: PublishNotificationInput) => {
        published.push(input);
        return { id: String(published.length), ...input } as any;
      },
      resolveIncident: async () => null
    };
    const scheduler = new HeatingScheduler(spa, new HeatingStore(dir), publisher as any);
    const now = Date.now();
    await scheduler.createSchedule({
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
    current = { ...current, waterTemperatureC: 39, updatedAt: now + 120_000 };
    await scheduler.processDue(now + 120_000);

    const started = published.find(item => item.type === 'heating.started');
    const reached = published.find(item => item.type === 'heating.target_reached');
    assert.equal(started?.severity, 'info');
    assert.equal(reached?.group, 'heating.progress');
    assert.equal(reached?.severity, 'warning');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
