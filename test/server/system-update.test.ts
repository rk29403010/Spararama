import assert from 'node:assert/strict';
import test from 'node:test';
import { isSystemUpdateEnabled, systemUpdateRequired } from '../../server/system/update';

test('system update control is enabled for Termux unless explicitly disabled', () => {
  assert.equal(isSystemUpdateEnabled({ PREFIX: '/data/data/com.termux/files/usr' }), true);
  assert.equal(isSystemUpdateEnabled({ PREFIX: '/data/data/com.termux/files/usr', SPAR_UI_UPDATE_ENABLED: '0' }), false);
});

test('system update control stays unavailable on non-Termux hosts', () => {
  assert.equal(isSystemUpdateEnabled({ PREFIX: '/usr' }), false);
  assert.equal(isSystemUpdateEnabled({}), false);
});

test('system update skips restart when target branch is already at the remote commit', () => {
  assert.equal(systemUpdateRequired({
    currentBranch: 'chatgpt-dev',
    targetBranch: 'chatgpt-dev',
    localCommit: 'abc123',
    remoteCommit: 'abc123'
  }), false);
});

test('system update runs when the remote commit or active branch differs', () => {
  assert.equal(systemUpdateRequired({
    currentBranch: 'chatgpt-dev',
    targetBranch: 'chatgpt-dev',
    localCommit: 'abc123',
    remoteCommit: 'def456'
  }), true);
  assert.equal(systemUpdateRequired({
    currentBranch: 'other-branch',
    targetBranch: 'chatgpt-dev',
    localCommit: 'abc123',
    remoteCommit: 'abc123'
  }), true);
});
