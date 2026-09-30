import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLogDateTime, formatLogTime } from '../../src/lib/dateTime';

const morning = new Date(2026, 8, 30, 7, 35, 0, 0).getTime();

test('12-hour times do not pad the hour with a leading zero', () => {
  const time = formatLogTime(morning, '12h');
  const dateTime = formatLogDateTime(morning, '12h');

  assert.match(time, /^7:35/);
  assert.doesNotMatch(time, /^07:/);
  assert.match(dateTime, /\b7:35/);
  assert.doesNotMatch(dateTime, /\b07:35/);
});

test('24-hour times keep a two-digit hour', () => {
  assert.equal(formatLogTime(morning, '24h'), '07:35');
});
