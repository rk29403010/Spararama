import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PUSH_TOKEN_MAX_CHARS,
  PushRegistrationStore,
  PushRegistrationStoreError
} from '../../server/push/store';

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

test('push registration store rejects oversized tokens and bounds registry growth', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-push-limits-'));
  try {
    const store = new PushRegistrationStore(dir, { maxRegistrations: 2, maxRegistryBytes: 64 * 1024 });

    await assert.rejects(
      store.upsert({ token: `x${'a'.repeat(PUSH_TOKEN_MAX_CHARS)}` }),
      (error: any) => error instanceof PushRegistrationStoreError
        && error.code === 'invalid_registration'
        && error.statusCode === 400
    );

    await store.upsert({ token: 'registration-token-number-000000000001' });
    await store.upsert({ token: 'registration-token-number-000000000002' });
    await assert.rejects(
      store.upsert({ token: 'registration-token-number-000000000003' }),
      (error: any) => error instanceof PushRegistrationStoreError
        && error.code === 'registry_full'
        && error.statusCode === 409
    );
    assert.equal((await store.list()).length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('push registration store refuses to load a registry beyond its byte ceiling', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-push-bytes-'));
  try {
    const store = new PushRegistrationStore(dir, { maxRegistryBytes: 128 });
    await fs.mkdir(path.dirname(store.statePath), { recursive: true });
    await fs.writeFile(store.statePath, JSON.stringify({ registrations: [{ token: 'x'.repeat(500) }] }));
    assert.deepEqual(await store.list(), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
