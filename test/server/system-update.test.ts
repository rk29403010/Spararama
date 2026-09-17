import assert from 'node:assert/strict';
import test from 'node:test';
import { isSystemUpdateEnabled } from '../../server/system/update';

test('system update control is enabled for Termux unless explicitly disabled', () => {
  assert.equal(isSystemUpdateEnabled({ PREFIX: '/data/data/com.termux/files/usr' }), true);
  assert.equal(isSystemUpdateEnabled({ PREFIX: '/data/data/com.termux/files/usr', SPAR_UI_UPDATE_ENABLED: '0' }), false);
});

test('system update control stays unavailable on non-Termux hosts', () => {
  assert.equal(isSystemUpdateEnabled({ PREFIX: '/usr' }), false);
  assert.equal(isSystemUpdateEnabled({}), false);
});
