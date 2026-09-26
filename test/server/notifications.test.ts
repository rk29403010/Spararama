import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NotificationService } from '../../server/notifications/service';
import { NotificationPreferenceStore } from '../../server/notifications/preferences';
import { NotificationStore } from '../../server/notifications/store';

async function withNotifications(run: (service: NotificationService, store: NotificationStore) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-notifications-'));
  try {
    const store = new NotificationStore(dir);
    const preferences = new NotificationPreferenceStore(dir);
    await run(new NotificationService(store, undefined, preferences), store);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('notification service deduplicates and escalates an incident', async () => {
  await withNotifications(async service => {
    const first = await service.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: 'warning',
      title: 'Hot tub is offline',
      message: 'Spararama cannot contact the hot tub.',
      incidentKey: 'spa-connectivity'
    });

    const unchanged = await service.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: 'warning',
      title: 'Hot tub is offline',
      message: 'Spararama cannot contact the hot tub.',
      incidentKey: 'spa-connectivity'
    });

    assert.equal(unchanged.id, first.id);
    assert.equal((await service.listActive()).length, 1);

    const escalated = await service.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: 'urgent',
      title: 'Heating cannot start - hot tub is offline',
      message: 'The planned ready time is at risk.',
      incidentKey: 'spa-connectivity'
    });

    assert.equal(escalated.id, first.id);
    assert.equal(escalated.severity, 'urgent');
    assert.equal((await service.listActive()).length, 1);
  });
});

test('notification service resolves a continuing incident', async () => {
  await withNotifications(async service => {
    await service.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: 'warning',
      title: 'Hot tub is offline',
      message: 'No contact.',
      incidentKey: 'spa-connectivity'
    });
    assert.equal((await service.listActive()).length, 1);

    const resolved = await service.resolveIncident('spa-connectivity', 'spa_reconnected');
    assert.ok(resolved?.resolvedAt);
    assert.equal(resolved?.resolutionReason, 'spa_reconnected');
    assert.equal((await service.listActive()).length, 0);
  });
});

test('notification service records independent per-device push outcomes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-notification-delivery-'));
  try {
    const store = new NotificationStore(dir);
    const preferences = new NotificationPreferenceStore(dir);
    const registrations = [
      { id: 'phone', userUid: 'robin', deviceName: 'Phone' },
      { id: 'desktop', userUid: 'robin', deviceName: 'Desktop' }
    ];
    const push = {
      enabled: true,
      listRegistrations: async () => registrations,
      sendNotificationToRegistration: async (registrationId: string) => {
        const success = registrationId === 'phone';
        return {
          enabled: true,
          targetCount: 1,
          successCount: success ? 1 : 0,
          failureCount: success ? 0 : 1,
          retryableFailureCount: success ? 0 : 1,
          removedInvalidCount: 0,
          targets: [success
            ? { registrationId, label: 'Phone', success: true, invalid: false, retryable: false }
            : { registrationId, label: 'Desktop', success: false, invalid: false, retryable: true, errorCode: 'messaging/internal-error', errorMessage: 'temporary failure' }]
        };
      }
    };
    const service = new NotificationService(store, push as any, preferences);
    const notice = await service.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: 'warning',
      title: 'Hot tub is offline',
      message: 'No contact.',
      incidentKey: 'spa-connectivity'
    });

    const state = await store.load();
    const deliveries = state.deliveries.filter(item => item.notificationId === notice.id);
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries.find(item => item.targetId === 'phone')?.status, 'provider_accepted');
    assert.equal(deliveries.find(item => item.targetId === 'desktop')?.errorCode, 'messaging/internal-error');
    assert.ok(deliveries.find(item => item.targetId === 'desktop')?.nextAttemptAt);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('personal group preference disables push without suppressing notification history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-notification-preference-'));
  try {
    const store = new NotificationStore(dir);
    const preferences = new NotificationPreferenceStore(dir);
    await preferences.updateUser('robin', { equipment: false });
    let sends = 0;
    const push = {
      enabled: true,
      listRegistrations: async () => [{ id: 'phone', userUid: 'robin', deviceName: 'Phone' }],
      sendNotificationToRegistration: async () => { sends += 1; throw new Error('should not send'); }
    };
    const service = new NotificationService(store, push as any, preferences);
    await service.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: 'warning',
      title: 'Hot tub is offline',
      message: 'No contact.',
      incidentKey: 'spa-connectivity'
    });

    assert.equal(sends, 0);
    assert.equal((await service.listActive()).length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('delivery-suppressed incident is recorded and sends once delivery resumes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-notification-suppression-'));
  try {
    const store = new NotificationStore(dir);
    const preferences = new NotificationPreferenceStore(dir);
    let sends = 0;
    const push = {
      enabled: true,
      listRegistrations: async () => [{ id: 'phone', userUid: 'robin', deviceName: 'Phone' }],
      sendNotificationToRegistration: async (registrationId: string) => {
        sends += 1;
        return {
          enabled: true,
          targetCount: 1,
          successCount: 1,
          failureCount: 0,
          retryableFailureCount: 0,
          removedInvalidCount: 0,
          targets: [{ registrationId, label: 'Phone', success: true, invalid: false, retryable: false }]
        };
      }
    };
    const service = new NotificationService(store, push as any, preferences);

    const suppressed = await service.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: 'warning',
      title: 'Hot tub is offline',
      message: 'No contact.',
      incidentKey: 'spa-connectivity',
      deliverySuppressed: true
    });
    assert.equal(sends, 0);
    assert.equal(suppressed.deliverySuppressed, true);
    assert.equal((await store.load()).deliveries.length, 0);

    const resumed = await service.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: 'warning',
      title: 'Hot tub is offline',
      message: 'No contact.',
      incidentKey: 'spa-connectivity',
      deliverySuppressed: false
    });
    assert.equal(resumed.id, suppressed.id);
    assert.equal(resumed.deliverySuppressed, undefined);
    assert.equal(sends, 1);
    assert.equal((await store.load()).deliveries.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
