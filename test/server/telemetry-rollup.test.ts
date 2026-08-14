import assert from 'node:assert/strict';
import test from 'node:test';
import { rollUpTelemetry } from '../../server/telemetry/rollup';
import type { TelemetrySample } from '../../server/telemetry/types';

function sample(index: number, temperature: number, heaterOn = false, target = 38): TelemetrySample {
  return {
    schemaVersion: 1,
    id: String(index),
    timestamp: index * 60_000,
    hostId: 'test',
    collectorVersion: 'test',
    changedFields: [],
    sensors: [],
    weather: [],
    spa: {
      transport: 'lan',
      connected: true,
      waterTemperatureC: temperature,
      targetTemperatureC: target,
      heaterOn,
      filterOn: true,
      bubblesOn: false,
      filterRuntimeSeconds: 0,
      heaterRuntimeSeconds: 0,
      updatedAt: index * 60_000
    }
  };
}

test('telemetry rollup keeps a hard point cap while preserving heater transitions', () => {
  const samples = Array.from({ length: 1000 }, (_, index) => sample(index, 20 + Math.sin(index / 20), index >= 400 && index < 600));
  const rolled = rollUpTelemetry(samples, 120);
  assert.ok(rolled.length <= 120);
  assert.ok(rolled.some(item => item.id === '399'));
  assert.ok(rolled.some(item => item.id === '400'));
  assert.ok(rolled.some(item => item.id === '599'));
  assert.ok(rolled.some(item => item.id === '600'));
});

test('telemetry rollup retains local temperature extrema', () => {
  const samples = Array.from({ length: 500 }, (_, index) => sample(index, 30));
  samples[123] = sample(123, 17);
  samples[321] = sample(321, 41);
  const rolled = rollUpTelemetry(samples, 100);
  assert.ok(rolled.some(item => item.spa.waterTemperatureC === 17));
  assert.ok(rolled.some(item => item.spa.waterTemperatureC === 41));
});
