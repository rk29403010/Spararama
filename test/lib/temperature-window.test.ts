import assert from 'node:assert/strict';
import test from 'node:test';
import { temperatureWindow, temperatureWindowLabel } from '../../src/lib/temperatureWindow';

test('daily history uses a calendar day and pages backwards one day at a time', () => {
  const now = new Date(2026, 8, 11, 12, 0, 0, 0).getTime();
  const current = temperatureWindow('daily', 0, now, '17:00');
  const previous = temperatureWindow('daily', 1, now, '17:00');

  assert.equal(new Date(current.since).getDate(), 11);
  assert.equal(new Date(previous.since).getDate(), 10);
  assert.equal(new Date(previous.end).getDate(), 11);
  assert.match(temperatureWindowLabel('daily', previous), /10 September 2026/);
});

test('two-day history pages through non-overlapping bounded windows', () => {
  const now = new Date(2026, 8, 11, 20, 0, 0, 0).getTime();
  const current = temperatureWindow('48h', 0, now, '17:00');
  const previous = temperatureWindow('48h', 1, now, '17:00');

  assert.equal(current.end - current.since, 48 * 60 * 60 * 1000);
  assert.equal(previous.end, current.since);
  assert.match(temperatureWindowLabel('48h', previous), /2026/);
});

test('page values cannot navigate into the future', () => {
  const now = new Date(2026, 8, 11, 20, 0, 0, 0).getTime();
  assert.deepEqual(temperatureWindow('7d', -5, now), temperatureWindow('7d', 0, now));
});
