import assert from 'node:assert/strict';
import test from 'node:test';
import { MockSpaAdapter } from '../../server/spa/mock';

test('heater automatically enables filtration', async () => {
  const spa = new MockSpaAdapter();
  const status = await spa.setHeater(true);
  assert.equal(status.heaterOn, true);
  assert.equal(status.filterOn, true);
  assert.equal(status.transport, 'mock');
});

test('turning filtration off also turns heating off', async () => {
  const spa = new MockSpaAdapter();
  await spa.setHeater(true);
  const status = await spa.setFilter(false);
  assert.equal(status.filterOn, false);
  assert.equal(status.heaterOn, false);
});

test('target temperature validation rejects unsafe mock values', async () => {
  const spa = new MockSpaAdapter();
  await assert.rejects(() => spa.setTargetTemperature(50), /between 5°C and 42°C/);
});
