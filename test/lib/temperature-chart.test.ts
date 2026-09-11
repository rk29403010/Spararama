import assert from 'node:assert/strict';
import test from 'node:test';
import { addWaterTrend } from '../../src/lib/temperatureChart';

test('water trend interpolates through repeated quantised buckets without changing raw readings', () => {
  const points = [30, 30, 30, 31, 31, 31, 32].map((water, index) => ({
    timestamp: index * 60_000,
    water,
    connected: true
  }));

  const result = addWaterTrend(points);
  assert.deepEqual(result.map(point => point.water), [30, 30, 30, 31, 31, 31, 32]);
  assert.equal(result[0].waterTrend, 30);
  assert.ok((result[1].waterTrend as number) > 30 && (result[1].waterTrend as number) < 31);
  assert.ok((result[2].waterTrend as number) > (result[1].waterTrend as number));
  assert.equal(result[3].waterTrend, 31);
  assert.ok((result[4].waterTrend as number) > 31 && (result[4].waterTrend as number) < 32);
  assert.equal(result[6].waterTrend, 32);
});

test('water trend removes an isolated one-reading reversal', () => {
  const result = addWaterTrend([30, 30, 29, 30, 30].map((water, index) => ({
    timestamp: index * 60_000,
    water,
    connected: true
  })));

  assert.deepEqual(result.map(point => point.water), [30, 30, 29, 30, 30]);
  assert.ok(result.every(point => point.waterTrend === 30));
});

test('water trend preserves a sustained peak', () => {
  const result = addWaterTrend([38, 39, 39, 38].map((water, index) => ({
    timestamp: index * 10 * 60_000,
    water,
    connected: true
  })));

  assert.equal(Math.max(...result.map(point => point.waterTrend as number)), 39);
});

test('non-water events inside a connected run inherit the trend instead of breaking the line', () => {
  const result = addWaterTrend([
    { timestamp: 0, water: 30, connected: true },
    { timestamp: 60_000, manualWater: 30.4 },
    { timestamp: 120_000, water: 31, connected: true }
  ]);

  assert.equal(result[1].waterTrend, 30.5);
});

test('water trend does not bridge a disconnected sample', () => {
  const result = addWaterTrend([
    { timestamp: 0, water: 30, connected: true },
    { timestamp: 60_000, water: 30, connected: true },
    { timestamp: 120_000, water: null, connected: false },
    { timestamp: 180_000, water: 40, connected: true },
    { timestamp: 240_000, water: 40, connected: true }
  ]);

  assert.equal(result[2].waterTrend, null);
  assert.equal(result[1].waterTrend, 30);
  assert.equal(result[3].waterTrend, 40);
});

test('water trend does not smooth across an unusually large telemetry gap', () => {
  const result = addWaterTrend([
    { timestamp: 0, water: 30, connected: true },
    { timestamp: 60_000, water: 30, connected: true },
    { timestamp: 120_000, water: 30, connected: true },
    { timestamp: 3_600_000, water: 40, connected: true },
    { timestamp: 3_660_000, water: 40, connected: true },
    { timestamp: 3_720_000, water: 40, connected: true }
  ]);

  assert.equal(result[2].waterTrend, 30);
  assert.equal(result[3].waterTrend, 40);
});
