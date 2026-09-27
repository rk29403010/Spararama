import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SpaConnectivityHistoryStore, type SpaConnectivityEpisode } from '../../server/health/connectivity-history';

function episode(id: string, durationMs: number, overrides: Partial<SpaConnectivityEpisode> = {}): SpaConnectivityEpisode {
  const startedAt = 1_000_000 + Number(id) * 1_000_000;
  return {
    id,
    startedAt,
    endedAt: startedAt + durationMs,
    durationMs,
    reachedOffline: durationMs >= 180_000,
    alertThresholdMs: 180_000,
    failureObservations: 4,
    sources: ['watchdog'],
    transports: ['lan'],
    maxContactFailureCount: 3,
    heatingThreatened: false,
    deliverySuppressed: false,
    ...overrides
  };
}

test('connectivity history learns a cautious idle grace from repeated short dropouts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-connectivity-history-'));
  try {
    const store = new SpaConnectivityHistoryStore(dir);
    await store.appendEpisode(episode('1', 210_000));
    await store.appendEpisode(episode('2', 225_000));
    await store.appendEpisode(episode('3', 240_000));
    await store.appendEpisode(episode('4', 255_000));

    const profile = await store.learningProfile(180_000);
    assert.equal(profile.transientSampleCount, 4);
    assert.ok(profile.learnedIdleOfflineAfterMs > 180_000);
    assert.ok(profile.learnedIdleOfflineAfterMs <= 8 * 60_000);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('connectivity learning ignores heating-threatening and planned-maintenance outages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-connectivity-history-'));
  try {
    const store = new SpaConnectivityHistoryStore(dir);
    await store.appendEpisode(episode('1', 300_000, { heatingThreatened: true }));
    await store.appendEpisode(episode('2', 300_000, { deliverySuppressed: true }));
    await store.appendEpisode(episode('3', 240_000));

    const profile = await store.learningProfile(180_000);
    assert.equal(profile.transientSampleCount, 1);
    assert.equal(profile.learnedIdleOfflineAfterMs, 180_000);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
