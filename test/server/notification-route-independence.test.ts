import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NotificationService } from '../../server/notifications/service';
import { NotificationStore } from '../../server/notifications/store';

test('showing a notification in one browser marks it seen without resolving delivery to other devices', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-notification-seen-'));
  try {
    const store = new NotificationStore(dir);
    const service = new NotificationService(store);
    const notification = await service.publish({
      type: 'heating.ready',
      group: 'heating.progress',
      severity: 'warning',
      title: 'Spa heat soak complete',
      message: 'The spa is ready.',
      incidentKey: 'heating:schedule-1:heat_soak_complete',
      expiresAt: Date.now() + 60_000
    });

    const seen = await service.resolveIncident(notification.incidentKey!, 'shown_in_app');
    assert.ok(seen?.seenAt);
    assert.equal(seen?.resolvedAt, undefined);
    assert.equal((await service.listActive()).length, 1);

    const state = await store.load();
    assert.equal(state.notifications[0].resolvedAt, undefined);
    assert.ok(state.notifications[0].seenAt);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
