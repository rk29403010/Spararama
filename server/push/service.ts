import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { HeatingNotification } from '../heating/types';
import { PushRegistrationStore } from './store';
import type { PushDeliveryResult } from './types';

const DEFAULT_PROJECT_ID = 'microprojects-481213';
const PUSH_APP_NAME = 'spararama-push';
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered'
]);

export interface PushConfig {
  enabled: boolean;
  projectId: string;
  publicVapidKey: string;
}

export function resolvePushConfig(): PushConfig {
  return {
    enabled: String(process.env.FIREBASE_PUSH_ENABLED || '').toLowerCase() === 'true',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    publicVapidKey: String(process.env.FIREBASE_WEB_PUSH_VAPID_KEY || '').trim()
  };
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

  register(input: { token: string; userAgent?: string; label?: string }) {
    return this.store.upsert(input);
  }

  unregister(id: string) {
    return this.store.removeById(id);
  }

  async sendHeatingNotification(notification: HeatingNotification): Promise<PushDeliveryResult> {
    if (!this.enabled || !this.app) {
      return { enabled: false, targetCount: 0, successCount: 0, failureCount: 0, retryableFailureCount: 0, removedInvalidCount: 0 };
    }

    const registrations = await this.store.list();
    const tokens = registrations.map(item => item.token);
    if (!tokens.length) {
      return { enabled: true, targetCount: 0, successCount: 0, failureCount: 0, retryableFailureCount: 0, removedInvalidCount: 0 };
    }

    try {
      const response = await getMessaging(this.app).sendEachForMulticast({
        tokens,
        data: {
          notificationId: notification.id,
          scheduleId: notification.scheduleId,
          kind: notification.kind,
          title: notification.title,
          body: notification.message,
          requiresConfirmation: String(notification.requiresConfirmation),
          url: '/'
        },
        webpush: {
          headers: { Urgency: notification.requiresConfirmation ? 'high' : 'normal' }
        }
      });

      const invalidTokens: string[] = [];
      let retryableFailureCount = 0;
      response.responses.forEach((item, index) => {
        if (item.success) return;
        const code = item.error?.code || '';
        if (INVALID_TOKEN_CODES.has(code)) invalidTokens.push(tokens[index]);
        else retryableFailureCount += 1;
      });
      const removedInvalidCount = await this.store.removeTokens(invalidTokens);
      return {
        enabled: true,
        targetCount: tokens.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
        retryableFailureCount,
        removedInvalidCount
      };
    } catch (error: any) {
      return {
        enabled: true,
        targetCount: tokens.length,
        successCount: 0,
        failureCount: tokens.length,
        retryableFailureCount: tokens.length,
        removedInvalidCount: 0,
        error: error?.message || String(error)
      };
    }
  }
}
