import assert from 'node:assert/strict';
import test from 'node:test';
import { BestEffortTemperatureResolver } from '../../server/spa/temperature';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';
import type { TelemetrySample } from '../../server/telemetry/types';

const NOW = 2_000_000_000_000;

function spaStatus(overrides: Partial<SpaStatus> = {}): SpaStatus {
  return {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 31,
    targetTemperatureC: 38,
    heaterOn: false,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0,
    updatedAt: NOW,
    ...overrides
  };
}

function sample(status: SpaStatus, timestamp = status.updatedAt): TelemetrySample {
  return {
    schemaVersion: 1,
    id: String(timestamp),
    timestamp,
    hostId: 'test',
    collectorVersion: 'test',
    spa: status,
    changedFields: [],
    sensors: [],
    weather: []
  };
}

function adapter(status: SpaStatus | Error, calls: { count: number }): SpaAdapter {
  const get = async () => {
    calls.count += 1;
    if (status instanceof Error) throw status;
    return status;
  };
  const unsupported = async () => { throw new Error('not used'); };
  return { getStatus: get, setHeater: unsupported, setFilter: unsupported, setBubbles: unsupported, setTargetTemperature: unsupported };
}

function store(samples: TelemetrySample[]) {
  return { readRecent: async () => ({ samples, total: samples.length }) } as any;
}

test('fairly fresh telemetry avoids an unnecessary spa read', async () => {
  const calls = { count: 0 };
  const recent = sample(spaStatus({ waterTemperatureC: 32, updatedAt: NOW - 60_000 }));
  const resolver = new BestEffortTemperatureResolver(adapter(new Error('should not connect'), calls), store([recent]));
  const value = await resolver.resolve({ now: NOW });

  assert.equal(value.valueC, 32);
  assert.equal(value.source, 'recent-telemetry');
  assert.equal(value.confidence, 'high');
  assert.equal(calls.count, 0);
});

test('stale telemetry triggers a direct spa read when available', async () => {
  const calls = { count: 0 };
  const stale = sample(spaStatus({ waterTemperatureC: 28, updatedAt: NOW - 20 * 60_000 }));
  const resolver = new BestEffortTemperatureResolver(adapter(spaStatus({ waterTemperatureC: 33, updatedAt: NOW - 5_000 }), calls), store([stale]));
  const value = await resolver.resolve({ now: NOW });

  assert.equal(value.valueC, 33);
  assert.equal(value.source, 'live-spa');
  assert.equal(value.confidence, 'high');
  assert.equal(calls.count, 1);
});

test('unreachable or manual spa falls back to the last useful water reading', async () => {
  const calls = { count: 0 };
  const old = sample(spaStatus({ connected: false, transport: 'manual', waterTemperatureC: 27, updatedAt: NOW - 3 * 60 * 60_000 }));
  const resolver = new BestEffortTemperatureResolver(adapter(new Error('offline'), calls), store([old]));
  const value = await resolver.resolve({ now: NOW });

  assert.equal(value.valueC, 27);
  assert.equal(value.source, 'last-known-water');
  assert.equal(value.estimated, true);
  assert.equal(value.confidence, 'low');
});

test('ambient observations are used only when no useful water reading exists', async () => {
  const calls = { count: 0 };
  const ambientSample = sample(spaStatus({ waterTemperatureC: Number.NaN, updatedAt: NOW - 60_000 }));
  ambientSample.weather = [{ source: 'test-weather', temperatureC: 18, observedAt: NOW - 60_000 }];
  const resolver = new BestEffortTemperatureResolver(adapter(new Error('offline'), calls), store([ambientSample]));
  const value = await resolver.resolve({ now: NOW });

  assert.equal(value.valueC, 18);
  assert.equal(value.source, 'weather');
  assert.equal(value.estimated, true);
  assert.equal(value.confidence, 'low');
});
