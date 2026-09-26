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
const PUSH_RETRY_TICK_MS = 30_000;
const PUSH_RETRY_MAX_MS = 15 * 60_000;
const MAX_PUSH_RETRY_ATTEMPTS = 12;

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function retryDelay(severity: NotificationSeverity, attemptNumber: number) {
  const base = severity === 'urgent' ? 30_000 : 60_000;
  return Math.min(PUSH_RETRY_MAX_MS, base * (2 ** Math.max(0, attemptNumber - 1)));
}

function pushPayload(notification: SpararamaNotification) {
  return {
    id: notification.id,
    type: notification.type,
    severity: notification.severity,
    title: notification.title,
    message: notification.message,
    requiresAcknowledgement: notification.requiresAcknowledgement,
    url: '/'
  } as const;
}

export class NotificationService {
  private operation = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly store = new NotificationStore(),
    private readonly push?: Pick<PushService, 'enabled' | 'sendNotification' | 'sendNotificationToRegistration'>
  ) {}

  start() {
    if (this.timer) return;
    void this.processRetries();
    this.timer = setInterval(() => void this.processRetries(), PUSH_RETRY_TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  listActive(now = Date.now()) {
    return this.store.load().then(state => state.notifications
      .filter(item => !item.resolvedAt && (!item.expiresAt || item.expiresAt > now))
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

  processRetries(now = Date.now()) {
    return this.enqueue(() => this.processRetriesInternal(now));
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
      const expiryChanged = existing.expiresAt !== input.expiresAt;
      const changed = titleChanged || messageChanged || contextChanged || typeChanged || acknowledgementChanged || severityChanged || expiryChanged;
      if (!changed) return existing;

      existing.type = input.type;
      existing.group = input.group;
      existing.severity = input.severity;
      existing.title = input.title;
      existing.message = input.message;
      existing.context = input.context;
      existing.expiresAt = input.expiresAt;
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
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
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

  private nextAttemptAt(notification: SpararamaNotification, attemptNumber: number, retryable: boolean) {
    if (!retryable || notification.severity === 'info' || attemptNumber >= MAX_PUSH_RETRY_ATTEMPTS) return undefined;
    return Date.now() + retryDelay(notification.severity, attemptNumber);
  }

  private async dispatchPush(state: NotificationStateFile, notification: SpararamaNotification, attemptedAt: number) {
    if (!this.push?.enabled) return;
    const result = await this.push.sendNotification(pushPayload(notification));
    if (!result.targets.length) return;

    const deliveries: NotificationDelivery[] = result.targets.map(target => ({
      id: crypto.randomUUID(),
      notificationId: notification.id,
      route: 'push',
      targetId: target.registrationId,
      ...(target.label ? { targetLabel: target.label } : {}),
      status: target.success ? 'provider_accepted' : 'failed',
      attemptNumber: 1,
      attemptedAt,
      ...(target.success ? { providerAcceptedAt: attemptedAt } : {}),
      ...(!target.success ? {
        retryable: target.retryable,
        ...(this.nextAttemptAt(notification, 1, target.retryable) ? { nextAttemptAt: this.nextAttemptAt(notification, 1, target.retryable) } : {}),
        ...(target.errorCode ? { errorCode: target.errorCode } : {}),
        ...(target.errorMessage ? { errorMessage: target.errorMessage } : {})
      } : {})
    }));
    state.deliveries.push(...deliveries);
    await this.store.save(state);
  }

  private async processRetriesInternal(now: number) {
    if (!this.push?.enabled) return;
    const state = await this.store.load();
    const notificationById = new Map(state.notifications.map(item => [item.id, item]));
    const latestByTarget = new Map<string, NotificationDelivery>();

    for (const delivery of state.deliveries) {
      if (delivery.route !== 'push') continue;
      const key = `${delivery.notificationId}:${delivery.targetId}`;
      const previous = latestByTarget.get(key);
      if (!previous || delivery.attemptedAt > previous.attemptedAt) latestByTarget.set(key, delivery);
    }

    let changed = false;
    for (const delivery of latestByTarget.values()) {
      if (delivery.status !== 'failed' || !delivery.retryable || !delivery.nextAttemptAt || now < delivery.nextAttemptAt) continue;
      if (delivery.attemptNumber >= MAX_PUSH_RETRY_ATTEMPTS) continue;
      const notification = notificationById.get(delivery.notificationId);
      if (!notification || notification.resolvedAt) continue;
      if (notification.expiresAt && notification.expiresAt <= now) continue;

      const attemptNumber = delivery.attemptNumber + 1;
      const result = await this.push.sendNotificationToRegistration(delivery.targetId, pushPayload(notification));
      const target = result.targets[0];
      const accepted = Boolean(target?.success);
      const retryable = Boolean(target?.retryable && !accepted);
      const record: NotificationDelivery = {
        id: crypto.randomUUID(),
        notificationId: notification.id,
        route: 'push',
        targetId: delivery.targetId,
        targetLabel: target?.label || delivery.targetLabel,
        status: accepted ? 'provider_accepted' : 'failed',
        attemptNumber,
        attemptedAt: now,
        ...(accepted ? { providerAcceptedAt: now } : {}),
        ...(!accepted ? {
          retryable,
          ...(retryable && attemptNumber < MAX_PUSH_RETRY_ATTEMPTS ? { nextAttemptAt: now + retryDelay(notification.severity, attemptNumber) } : {}),
          errorCode: target?.errorCode || (result.targetCount === 0 ? 'registration_missing' : 'push_failed'),
          errorMessage: target?.errorMessage || result.error || (result.targetCount === 0 ? 'Push registration no longer exists.' : 'Push delivery failed.')
        } : {})
      };
      state.deliveries.push(record);
      changed = true;
    }

    if (changed) await this.store.save(state);
  }
}
