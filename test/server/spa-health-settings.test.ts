import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SpaHealthSettingsStore } from '../../server/health/settings';

test('spa health alert pause expires automatically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-health-settings-'));
  try {
    const store = new SpaHealthSettingsStore(dir);
    const now = 1_000_000;
    await store.update({ offlineAlertsPaused: true, offlineAlertsPausedUntil: now + 60_000 }, 'user-1', now);

    assert.equal((await store.get(now + 30_000)).offlineAlertsPaused, true);
    const expired = await store.get(now + 61_000);
    assert.equal(expired.offlineAlertsPaused, false);
    assert.equal(expired.offlineAlertsPausedUntil, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('spa health alert pause can remain active until explicitly resumed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-health-settings-indefinite-'));
  try {
    const store = new SpaHealthSettingsStore(dir);
    const now = 2_000_000;
    const paused = await store.update({ offlineAlertsPaused: true }, 'user-1', now);
    assert.equal(paused.offlineAlertsPaused, true);
    assert.equal(paused.offlineAlertsPausedUntil, undefined);
    assert.equal(await store.isOfflineAlertSuppressed(now + 7 * 24 * 60 * 60_000), true);

    await store.update({ offlineAlertsPaused: false }, 'user-1', now + 1_000);
    assert.equal(await store.isOfflineAlertSuppressed(now + 2_000), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
