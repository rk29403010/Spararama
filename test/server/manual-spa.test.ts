import assert from 'node:assert/strict';
import test from 'node:test';
import { ManualSpaAdapter } from '../../server/spa/manual';

test('manual adapter reports no live connection without pretending values are zero', async () => {
  const status = await new ManualSpaAdapter().getStatus();
  assert.equal(status.transport, 'manual');
  assert.equal(status.connected, false);
  assert.equal(Number.isNaN(status.waterTemperatureC), true);
  assert.equal(Number.isNaN(status.targetTemperatureC), true);
});

test('manual adapter rejects remote controls with a useful explanation', async () => {
  const adapter = new ManualSpaAdapter();
  await assert.rejects(() => adapter.setHeater(true), /no remote control adapter configured/i);
});
