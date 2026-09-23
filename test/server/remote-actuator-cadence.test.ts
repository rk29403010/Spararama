import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteCommandExecutor } from '../../server/remote/executor';
import type { RemoteCommandEnvelope } from '../../server/remote/types';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';

const NOW = 1_800_000_000_000;

function envelope(commandId: string, type: 'setHeater' | 'setFilter', payload: { on: boolean }) {
  return {
    version: 1,
    commandId,
    installationId: 'home-spa',
    type,
    payload,
    createdAt: NOW - 1_000,
    expiresAt: NOW + 30_000,
    requestedBy: { kind: 'user', id: 'user-1' }
  } as RemoteCommandEnvelope;
}

test('remote physical writes are serialized and respect the local actuator cadence', async () => {
  let cadenceNow = 10_000;
  let current: SpaStatus = {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 35,
    targetTemperatureC: 38,
    heaterOn: false,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0,
    updatedAt: NOW
  };
  const starts: number[] = [];
  const spa: SpaAdapter = {
    getStatus: async () => ({ ...current }),
    setHeater: async on => {
      starts.push(cadenceNow);
      current = { ...current, heaterOn: on };
      return { ...current };
    },
    setFilter: async on => {
      starts.push(cadenceNow);
      current = { ...current, filterOn: on };
      return { ...current };
    },
    setBubbles: async on => ({ ...current, bubblesOn: on }),
    setTargetTemperature: async celsius => ({ ...current, targetTemperatureC: celsius })
  };
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    now: () => NOW,
    actuatorMinIntervalMs: 1_000,
    cadenceNow: () => cadenceNow,
    sleep: async milliseconds => { cadenceNow += milliseconds; }
  });

  const [heater, filter] = await Promise.all([
    executor.execute(envelope('heater-on', 'setHeater', { on: true })),
    executor.execute(envelope('filter-off', 'setFilter', { on: false }))
  ]);

  assert.equal(heater.status, 'succeeded');
  assert.equal(filter.status, 'succeeded');
  assert.deepEqual(starts, [10_000, 11_000]);
});

test('remote no-op commands do not consume an actuator cadence slot', async () => {
  let cadenceNow = 20_000;
  const starts: number[] = [];
  let current: SpaStatus = {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 35,
    targetTemperatureC: 38,
    heaterOn: true,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0,
    updatedAt: NOW
  };
  const spa: SpaAdapter = {
    getStatus: async () => ({ ...current }),
    setHeater: async on => {
      starts.push(cadenceNow);
      current = { ...current, heaterOn: on };
      return { ...current };
    },
    setFilter: async on => {
      starts.push(cadenceNow);
      current = { ...current, filterOn: on };
      return { ...current };
    },
    setBubbles: async on => ({ ...current, bubblesOn: on }),
    setTargetTemperature: async celsius => ({ ...current, targetTemperatureC: celsius })
  };
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    now: () => NOW,
    actuatorMinIntervalMs: 1_000,
    cadenceNow: () => cadenceNow,
    sleep: async milliseconds => { cadenceNow += milliseconds; }
  });

  await executor.execute(envelope('heater-already-on', 'setHeater', { on: true }));
  await executor.execute(envelope('filter-off-after-noop', 'setFilter', { on: false }));

  assert.deepEqual(starts, [20_000]);
});
