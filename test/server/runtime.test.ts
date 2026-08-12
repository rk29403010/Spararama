import assert from 'node:assert/strict';
import test from 'node:test';
import { MockSpaAdapter } from '../../server/spa/mock';

test('runtime counters accumulate while equipment is on', async () => {
  let now = 1_000_000;
  const spa = new MockSpaAdapter(() => now);

  await spa.setFilter(true);
  now += 3_600_000;
  const afterFilterHour = await spa.getStatus();
  assert.equal(afterFilterHour.filterRuntimeSeconds, 3600);
  assert.equal(afterFilterHour.heaterRuntimeSeconds, 0);

  await spa.setHeater(true);
  now += 1_800_000;
  const afterHeating = await spa.getStatus();
  assert.equal(afterHeating.filterRuntimeSeconds, 5400);
  assert.equal(afterHeating.heaterRuntimeSeconds, 1800);
});
