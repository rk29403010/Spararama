import type { PushService } from '../push/service';
import { NotificationStore } from './store';
import type {
  NotificationDelivery,
  NotificationSeverity,
  NotificationStateFile,
  PublishNotificationInput,
  SpararamaNotification
} from './types';

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  info: 0,
  warning: 1,
  urgent: 2
};

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export class NotificationService {
  private operation = Promise.resolve();

  constructor(
    readonly store = new NotificationStore(),
    private readonly push?: Pick<PushService, 'enabled' | 'sendNotification'>
  ) {}

  listActive() {
    return this.store.load().then(state => state.notifications
      .filter(item => !item.resolvedAt)
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.updatedAt - a.updatedAt));
  }

  listRecent(limit = 100) {
    return this.store.load().then(state => [...state.notifications]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, Math.min(500, limit))));
  }

  publish(input: PublishNotificationInput) {
    return this.enqueue(() => this.publishInternal(input));
  }

  resolveIncident(incidentKey: string, reason = 'condition_cleared') {
    return this.enqueue(async () => {
      const state = await this.store.load();
      const notification = state.notifications.find(item => item.incidentKey === incidentKey && !item.resolvedAt);
      if (!notification) return null;
      const now = Date.now();
      notification.resolvedAt = now;
      notification.updatedAt = now;
      notification.resolutionReason = reason;
      await this.store.save(state);
      await this.store.appendEvent({
        id: crypto.randomUUID(),
        notificationId: notification.id,
        timestamp: now,
        type: 'notification_resolved',
        details: { incidentKey, reason }
      });
      return notification;
    });
  }

  acknowledge(id: string, uid?: string) {
    return this.enqueue(async () => {
      const state = await this.store.load();
      const notification = state.notifications.find(item => item.id === id);
      if (!notification) throw new Error('Notification not found.');
      if (!notification.acknowledgedAt) {
        const now = Date.now();
        notification.acknowledgedAt = now;
        notification.updatedAt = now;
        if (uid) notification.acknowledgedByUid = uid;
        await this.store.save(state);
        await this.store.appendEvent({
          id: crypto.randomUUID(),
          notificationId: id,
          timestamp: now,
          type: 'notification_acknowledged',
          details: uid ? { uid } : undefined
        });
      }
      return notification;
    });
  }

  private enqueue<T>(work: () => Promise<T>) {
    const result = this.operation.then(work, work);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async publishInternal(input: PublishNotificationInput) {
    const state = await this.store.load();
    const now = Date.now();
    const existing = input.incidentKey
      ? state.notifications.find(item => item.incidentKey === input.incidentKey && !item.resolvedAt)
      : undefined;

    if (existing) {
      const previousSeverity = existing.severity;
      const titleChanged = existing.title !== input.title;
      const messageChanged = existing.message !== input.message;
      const contextChanged = !sameJson(existing.context, input.context);
      const typeChanged = existing.type !== input.type || existing.group !== input.group;
      const acknowledgementChanged = existing.requiresAcknowledgement !== Boolean(input.requiresAcknowledgement);
      const severityChanged = existing.severity !== input.severity;
      const changed = titleChanged || messageChanged || contextChanged || typeChanged || acknowledgementChanged || severityChanged;
      if (!changed) return existing;

      existing.type = input.type;
      existing.group = input.group;
      existing.severity = input.severity;
      existing.title = input.title;
      existing.message = input.message;
      existing.context = input.context;
      existing.requiresAcknowledgement = Boolean(input.requiresAcknowledgement);
      existing.updatedAt = now;

      const escalated = SEVERITY_RANK[input.severity] > SEVERITY_RANK[previousSeverity];
      await this.store.save(state);
      await this.store.appendEvent({
        id: crypto.randomUUID(),
        notificationId: existing.id,
        timestamp: now,
        type: escalated ? 'notification_escalated' : 'notification_updated',
        details: {
          incidentKey: input.incidentKey,
          previousSeverity,
          severity: input.severity
        }
      });

      if (escalated || titleChanged || messageChanged) await this.dispatchPush(state, existing, now);
      return existing;
    }

    const notification: SpararamaNotification = {
      id: crypto.randomUUID(),
      type: input.type,
      group: input.group,
      severity: input.severity,
      title: input.title,
      message: input.message,
      createdAt: now,
      updatedAt: now,
      ...(input.incidentKey ? { incidentKey: input.incidentKey } : {}),
      ...(input.context ? { context: input.context } : {}),
      requiresAcknowledgement: Boolean(input.requiresAcknowledgement)
    };
    state.notifications.push(notification);
    await this.store.save(state);
    await this.store.appendEvent({
      id: crypto.randomUUID(),
      notificationId: notification.id,
      timestamp: now,
      type: 'notification_opened',
      details: {
        type: notification.type,
        group: notification.group,
        severity: notification.severity,
        ...(notification.incidentKey ? { incidentKey: notification.incidentKey } : {})
      }
    });
    await this.dispatchPush(state, notification, now);
    return notification;
  }

  private async dispatchPush(state: NotificationStateFile, notification: SpararamaNotification, attemptedAt: number) {
    if (!this.push?.enabled) return;
    const result = await this.push.sendNotification({
      id: notification.id,
      type: notification.type,
      severity: notification.severity,
      title: notification.title,
      message: notification.message,
      requiresAcknowledgement: notification.requiresAcknowledgement,
      url: '/'
    });
    if (!result.targets.length) return;

    const deliveries: NotificationDelivery[] = result.targets.map(target => ({
      id: crypto.randomUUID(),
      notificationId: notification.id,
      route: 'push',
      targetId: target.registrationId,
      ...(target.label ? { targetLabel: target.label } : {}),
      status: target.success ? 'provider_accepted' : 'failed',
      attemptedAt,
      ...(target.success ? { providerAcceptedAt: attemptedAt } : {}),
      ...(!target.success ? {
        retryable: target.retryable,
        ...(target.errorCode ? { errorCode: target.errorCode } : {}),
        ...(target.errorMessage ? { errorMessage: target.errorMessage } : {})
      } : {})
    }));
    state.deliveries.push(...deliveries);
    await this.store.save(state);
  }
}
