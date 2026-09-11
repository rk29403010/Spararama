import assert from 'node:assert/strict';
import test from 'node:test';
import { addWaterTrend } from '../../src/lib/temperatureChart';

test('water trend smooths quantised chatter without changing raw readings', () => {
  const points = [30, 31, 30, 31, 30].map((water, index) => ({
    timestamp: index * 60_000,
    water,
    connected: true
  }));

  const result = addWaterTrend(points);
  assert.deepEqual(result.map(point => point.water), [30, 31, 30, 31, 30]);
  assert.ok(result.every(point => typeof point.waterTrend === 'number'));

  const rawRange = Math.max(...points.map(point => point.water)) - Math.min(...points.map(point => point.water));
  const trendValues = result.map(point => point.waterTrend as number);
  const trendRange = Math.max(...trendValues) - Math.min(...trendValues);
  assert.ok(trendRange < rawRange);
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
