import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { HeatingNotification } from '../heating/types';
import { PushRegistrationStore } from './store';
import type { PushDeliveryResult, PushRegistration, PushTargetDeliveryResult } from './types';

const DEFAULT_PROJECT_ID = 'microprojects-481213';
const PUSH_APP_NAME = 'spararama-push';
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered'
]);

const ATTENTION_KINDS = new Set<HeatingNotification['kind']>([
  'manual_start_required',
  'target_reached',
  'heat_soak_complete'
]);

export interface PushConfig {
  enabled: boolean;
  projectId: string;
  publicVapidKey: string;
}

export interface GenericPushNotification {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'urgent';
  title: string;
  message: string;
  requiresAcknowledgement?: boolean;
  url?: string;
}

interface PushPayload {
  notificationId: string;
  kind: string;
  severity: 'info' | 'warning' | 'urgent';
  title: string;
  body: string;
  requiresConfirmation: boolean;
  url: string;
  scheduleId?: string;
}

export function resolvePushConfig(): PushConfig {
  return {
    enabled: String(process.env.FIREBASE_PUSH_ENABLED || '').toLowerCase() === 'true',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    publicVapidKey: String(process.env.FIREBASE_WEB_PUSH_VAPID_KEY || '').trim()
  };
}

function notificationCopy(notification: HeatingNotification) {
  if (notification.kind === 'target_reached') {
    return { title: 'Hot tub temperature reached.', body: '' };
  }
  if (notification.kind === 'heat_soak_complete') {
    return { title: 'Your hot tub is ready!', body: '' };
  }
  return { title: notification.title, body: notification.message };
}

function deliveryErrorSummary(targets: PushTargetDeliveryResult[]) {
  const failure = targets.find(item => !item.success);
  if (!failure) return undefined;
  const target = failure.label || failure.registrationId;
  const code = failure.errorCode || 'messaging/unknown-error';
  const message = failure.errorMessage ? ` - ${failure.errorMessage}` : '';
  return `${target}: ${code}${message}`;
}

function safeRegistration(registration: PushRegistration) {
  const { token: _token, ...safe } = registration;
  return safe;
}

export class PushService {
  readonly config: PushConfig;
  readonly store: PushRegistrationStore;
  private app: App | null = null;

  constructor(store = new PushRegistrationStore()) {
    this.store = store;
    this.config = resolvePushConfig();
    if (!this.config.enabled) return;
    this.app = getApps().find(candidate => candidate.name === PUSH_APP_NAME)
      || initializeApp({ credential: applicationDefault(), projectId: this.config.projectId }, PUSH_APP_NAME);
  }

  get enabled() {
    return this.config.enabled;
  }

  async status() {
    const registrations = await this.store.list();
    return {
      enabled: this.enabled,
      configured: this.enabled && Boolean(this.config.publicVapidKey),
      projectId: this.config.projectId,
      registrationCount: registrations.length,
      vapidKey: this.config.publicVapidKey || undefined
    };
  }

  register(input: {
    token: string;
    userUid?: string;
    deviceId?: string;
    deviceName?: string;
    userAgent?: string;
    label?: string;
  }) {
    return this.store.upsert(input);
  }

  unregister(id: string, userUid?: string) {
    return this.store.removeById(id, userUid);
  }

  async listRegistrations(userUid?: string) {
    return (await this.store.list(userUid)).map(safeRegistration);
  }

  sendNotification(notification: GenericPushNotification): Promise<PushDeliveryResult> {
    return this.sendPayload({
      notificationId: notification.id,
      kind: notification.type,
      severity: notification.severity,
      title: notification.title,
      body: notification.message,
      requiresConfirmation: Boolean(notification.requiresAcknowledgement),
      url: notification.url || '/'
    });
  }

  sendNotificationToRegistration(
    registrationId: string,
    userUid: string,
    notification: GenericPushNotification
  ): Promise<PushDeliveryResult> {
    return this.sendPayload({
      notificationId: notification.id,
      kind: notification.type,
      severity: notification.severity,
      title: notification.title,
      body: notification.message,
      requiresConfirmation: Boolean(notification.requiresAcknowledgement),
      url: notification.url || '/'
    }, [registrationId], userUid);
  }

  async sendHeatingNotification(notification: HeatingNotification): Promise<PushDeliveryResult> {
    const copy = notificationCopy(notification);
    return this.sendPayload({
      notificationId: notification.id,
      scheduleId: notification.scheduleId,
      kind: notification.kind,
      severity: ATTENTION_KINDS.has(notification.kind) ? 'urgent' : 'info',
      title: copy.title,
      body: copy.body,
      requiresConfirmation: notification.requiresConfirmation,
      url: '/'
    });
  }

  private async sendPayload(
    payload: PushPayload,
    registrationIds?: string[],
    userUid?: string
  ): Promise<PushDeliveryResult> {
    if (!this.enabled || !this.app) {
      return {
        enabled: false,
        targetCount: 0,
        successCount: 0,
        failureCount: 0,
        retryableFailureCount: 0,
        removedInvalidCount: 0,
        targets: []
      };
    }

    let registrations = await this.store.list(userUid);
    if (registrationIds?.length) {
      const selected = new Set(registrationIds);
      registrations = registrations.filter(item => selected.has(item.id));
    }
    const tokens = registrations.map(item => item.token);
    if (!tokens.length) {
      return {
        enabled: true,
        targetCount: 0,
        successCount: 0,
        failureCount: 0,
        retryableFailureCount: 0,
        removedInvalidCount: 0,
        targets: []
      };
    }

    const attemptedAt = Date.now();
    try {
      const response = await getMessaging(this.app).sendEachForMulticast({
        tokens,
        data: {
          notificationId: payload.notificationId,
          kind: payload.kind,
          severity: payload.severity,
          title: payload.title,
          body: payload.body,
          requiresConfirmation: String(payload.requiresConfirmation),
          url: payload.url,
          ...(payload.scheduleId ? { scheduleId: payload.scheduleId } : {})
        },
        webpush: {
          headers: {
            Urgency: payload.severity === 'urgent' ? 'high' : 'normal',
            TTL: payload.severity === 'urgent' ? '900' : '3600'
          }
        }
      });

      const invalidTokens: string[] = [];
      const targets: PushTargetDeliveryResult[] = response.responses.map((item, index) => {
        const registration = registrations[index];
        if (item.success) {
          return {
            registrationId: registration.id,
            label: registration.deviceName || registration.label,
            userAgent: registration.userAgent,
            success: true,
            invalid: false,
            retryable: false
          };
        }

        const code = item.error?.code || 'messaging/unknown-error';
        const invalid = INVALID_TOKEN_CODES.has(code);
        if (invalid) invalidTokens.push(registration.token);
        return {
          registrationId: registration.id,
          label: registration.deviceName || registration.label,
          userAgent: registration.userAgent,
          success: false,
          invalid,
          retryable: !invalid,
          errorCode: code,
          errorMessage: item.error?.message || 'Firebase rejected the push notification.'
        };
      });

      await this.store.recordDeliveryResults(targets, attemptedAt);
      const retryableFailureCount = targets.filter(item => !item.success && item.retryable).length;
      const removedInvalidCount = await this.store.removeTokens(invalidTokens);
      return {
        enabled: true,
        targetCount: tokens.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
        retryableFailureCount,
        removedInvalidCount,
        targets,
        ...(response.successCount === 0 && response.failureCount > 0 ? { error: deliveryErrorSummary(targets) } : {})
      };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      const errorCode = typeof error?.code === 'string' ? error.code : undefined;
      const targets: PushTargetDeliveryResult[] = registrations.map(registration => ({
        registrationId: registration.id,
        label: registration.deviceName || registration.label,
        userAgent: registration.userAgent,
        success: false,
        invalid: false,
        retryable: true,
        errorCode,
        errorMessage
      }));
      await this.store.recordDeliveryResults(targets, attemptedAt);
      return {
        enabled: true,
        targetCount: tokens.length,
        successCount: 0,
        failureCount: tokens.length,
        retryableFailureCount: tokens.length,
        removedInvalidCount: 0,
        targets,
        error: errorMessage
      };
    }
  }
}
