import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NotificationService } from '../../server/notifications/service';
import { NotificationStore } from '../../server/notifications/store';

async function withNotifications(run: (service: NotificationService, store: NotificationStore) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-notifications-'));
  try {
    const store = new NotificationStore(dir);
    await run(new NotificationService(store), store);
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

test('notification service records per-target push outcomes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-notification-delivery-'));
  try {
    const store = new NotificationStore(dir);
    const push = {
      enabled: true,
      sendNotification: async () => ({
        enabled: true,
        targetCount: 2,
        successCount: 1,
        failureCount: 1,
        retryableFailureCount: 1,
        removedInvalidCount: 0,
        targets: [
          { registrationId: 'phone', label: 'Phone', success: true, invalid: false, retryable: false },
          { registrationId: 'desktop', label: 'Desktop', success: false, invalid: false, retryable: true, errorCode: 'messaging/internal-error', errorMessage: 'temporary failure' }
        ]
      })
    };
    const service = new NotificationService(store, push as any);
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
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
