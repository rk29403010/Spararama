import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PushRegistrationStore } from '../../server/push/store';

test('push registration store deduplicates tokens and removes invalid registrations', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-push-'));
  try {
    const store = new PushRegistrationStore(dir);
    const token = 'test-fcm-registration-token-1234567890';
    const first = await store.upsert({ token, label: 'phone' });
    const second = await store.upsert({ token, label: 'phone refreshed' });

    assert.equal(first.id, second.id);
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.list())[0].label, 'phone refreshed');

    assert.equal(await store.removeTokens([token]), 1);
    assert.equal((await store.list()).length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
