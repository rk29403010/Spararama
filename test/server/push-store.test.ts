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

test('push registration store keeps a stable user device when its FCM token rotates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-push-device-'));
  try {
    const store = new PushRegistrationStore(dir);
    const first = await store.upsert({
      token: 'first-registration-token-000000000001',
      userUid: 'user-1',
      deviceId: 'device-1',
      deviceName: 'Robin S24 Ultra'
    });
    const second = await store.upsert({
      token: 'rotated-registration-token-0000000002',
      userUid: 'user-1',
      deviceId: 'device-1',
      deviceName: 'Robin S24 Ultra'
    });

    assert.equal(second.id, first.id);
    assert.equal((await store.list('user-1')).length, 1);
    assert.equal((await store.list('user-1'))[0].token, 'rotated-registration-token-0000000002');
    assert.equal((await store.list('someone-else')).length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('push registration store only lets an owning user rename a device', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-push-rename-'));
  try {
    const store = new PushRegistrationStore(dir);
    const registration = await store.upsert({
      token: 'rename-registration-token-000000000001',
      userUid: 'user-1',
      deviceId: 'device-1',
      deviceName: 'Android device'
    });

    const renamed = await store.renameById(registration.id, 'user-1', 'Robin S24 Ultra');
    assert.equal(renamed.deviceName, 'Robin S24 Ultra');
    assert.equal((await store.list('user-1'))[0].deviceName, 'Robin S24 Ultra');

    await assert.rejects(
      store.renameById(registration.id, 'user-2', 'Not mine'),
      (error: any) => error instanceof PushRegistrationStoreError
        && error.code === 'registration_not_found'
        && error.statusCode === 404
    );
    assert.equal((await store.list('user-1'))[0].deviceName, 'Robin S24 Ultra');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('push registration store records delivery health per device', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-push-health-'));
  try {
    const store = new PushRegistrationStore(dir);
    const registration = await store.upsert({
      token: 'health-registration-token-000000000001',
      userUid: 'user-1',
      deviceId: 'device-1'
    });

    await store.recordDeliveryResults([{
      registrationId: registration.id,
      success: false,
      invalid: false,
      retryable: true,
      errorCode: 'messaging/internal-error',
      errorMessage: 'temporary failure'
    }], 1_000);
    let saved = (await store.list())[0];
    assert.equal(saved.consecutiveDeliveryFailures, 1);
    assert.equal(saved.lastDeliveryErrorCode, 'messaging/internal-error');

    await store.recordDeliveryResults([{
      registrationId: registration.id,
      success: true,
      invalid: false,
      retryable: false
    }], 2_000);
    saved = (await store.list())[0];
    assert.equal(saved.consecutiveDeliveryFailures, 0);
    assert.equal(saved.lastProviderAcceptedAt, 2_000);
    assert.equal(saved.lastDeliveryErrorCode, undefined);
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
