import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AlexaAlertDispatcher } from '../../server/alerts/alexa-dispatcher';
import { NotificationPreferenceStore } from '../../server/notifications/preferences';
import { NotificationService } from '../../server/notifications/service';
import { NotificationStore } from '../../server/notifications/store';

test('Alexa delivery is driven by unified notifications and written to delivery audit', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-alexa-notifications-'));
  try {
    const notificationDir = path.join(dir, 'notifications');
    const alertDir = path.join(dir, 'alerts');
    const store = new NotificationStore(notificationDir);
    const preferences = new NotificationPreferenceStore(notificationDir);
    const notifications = new NotificationService(store, undefined, preferences);
    const notice = await notifications.publish({
      type: 'heating.ready',
      group: 'heating.progress',
      severity: 'warning',
      title: 'Spa heat soak complete',
      message: 'The spa is ready.',
      incidentKey: 'heating:schedule-1:heat_soak_complete',
      expiresAt: Date.now() + 60_000
    });

    const spoken: string[] = [];
    const voiceMonkey = {
      status: async () => ({ enabled: true, configured: true }),
      announce: async (text: string) => { spoken.push(text); return { sent: true }; },
      configure: async () => ({}),
      listSpeakers: async () => []
    };
    const dispatcher = new AlexaAlertDispatcher(store, preferences, voiceMonkey as any, alertDir);
    await dispatcher.process();

    assert.deepEqual(spoken, ['Your hot tub is ready!']);
    const lines = (await fs.readFile(store.deliveriesPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const delivery = lines.find(item => item.notificationId === notice.id && item.route === 'alexa');
    assert.ok(delivery);
    assert.equal(delivery.status, 'provider_accepted');
    assert.equal(delivery.targetId, 'household-alexa');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('resolved notifications are not retried through Alexa', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-alexa-resolved-'));
  try {
    const notificationDir = path.join(dir, 'notifications');
    const store = new NotificationStore(notificationDir);
    const preferences = new NotificationPreferenceStore(notificationDir);
    const notifications = new NotificationService(store, undefined, preferences);
    const notice = await notifications.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: 'warning',
      title: 'Hot tub is offline',
      message: 'No contact.',
      incidentKey: 'spa-connectivity'
    });
    await notifications.resolveIncident(notice.incidentKey!, 'spa_reconnected');

    let sends = 0;
    const voiceMonkey = {
      status: async () => ({ enabled: true, configured: true }),
      announce: async () => { sends += 1; return { sent: true }; },
      configure: async () => ({}),
      listSpeakers: async () => []
    };
    const dispatcher = new AlexaAlertDispatcher(store, preferences, voiceMonkey as any, path.join(dir, 'alerts'));
    await dispatcher.process();
    assert.equal(sends, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
