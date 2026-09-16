import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateHeatingPlan, volumeAdjustedHeatingRate } from '../../src/domain/heating';

function close(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('volume-adjusted heating rate preserves the 800 L reference profile', () => {
  close(volumeAdjustedHeatingRate(1.5, 800, 800), 1.5);
  close(volumeAdjustedHeatingRate(1.5, 1000, 800), 1.2);
});

test('shared heating estimate preserves the previous neutral-weather calculation', () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const targetTime = Date.parse('2026-09-05T18:00:00Z');
  const estimate = estimateHeatingPlan({
    mode: 'by-time',
    now,
    currentTemperatureC: 35,
    targetTemperatureC: 38,
    targetTime,
    baseHeatingRateCPerHour: 1.5,
    waterVolumeLiters: 800,
    referenceVolumeLiters: 800,
    heatSoakMinutes: 30,
    heaterPowerWatts: 1800,
    electricityRatePerKwh: 0.2
  });

  close(estimate.effectiveHeatingRateCPerHour, 1.5);
  close(estimate.totalHours, 2.5);
  assert.equal(estimate.startTime, Date.parse('2026-09-05T15:30:00Z'));
  close(estimate.costEstimate, 0.81);
  assert.equal(estimate.canMeetTarget, true);
});

test('shared heating estimate applies the same weather penalties used by the Heating UI', () => {
  const now = Date.parse('2026-09-05T14:00:00Z');
  const targetTime = Date.parse('2026-09-05T19:00:00Z');
  const times = Array.from({ length: 6 }, (_, index) => now + index * 60 * 60 * 1000);
  const estimate = estimateHeatingPlan({
    mode: 'by-time',
    now,
    currentTemperatureC: 35,
    targetTemperatureC: 38,
    targetTime,
    baseHeatingRateCPerHour: 1.5,
    waterVolumeLiters: 800,
    referenceVolumeLiters: 800,
    heatSoakMinutes: 30,
    weather: {
      derived: {
        time: times,
        temperatureC: times.map(() => 5),
        windSpeedMps: times.map(() => 20 / 3.6),
        precipitationMm: times.map(() => 0),
        shortwaveRadiationWm2: times.map(() => 0)
      },
      influence: { temperature: 1, wind: 1, solar: 0, precipitation: 0 },
      sourceCount: 3,
      samplingMode: 'triangulate'
    }
  });

  close(estimate.effectiveHeatingRateCPerHour, 0.9, 1e-8);
  close(estimate.totalHours, (3 / 0.9) + 0.5, 1e-8);
  assert.equal(estimate.weatherSourceCount, 3);
  assert.equal(estimate.weatherSamplingMode, 'triangulate');
  assert.equal(estimate.avgAmbientTemperatureC, 5);
  close(estimate.avgWindSpeedKph, 20, 1e-8);
});
