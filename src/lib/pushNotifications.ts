import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseApp } from './firebase';

const REGISTRATION_ID_KEY = 'spararama_push_registration_id';

export interface PushConfigDto {
  enabled: boolean;
  configured: boolean;
  projectId: string;
  registrationCount: number;
  vapidKey?: string;
  browserApiKeyConfigured: boolean;
}

export type PushSetupStatus =
  | 'enabled'
  | 'disabled'
  | 'permission-required'
  | 'permission-denied'
  | 'insecure-origin'
  | 'unsupported';

export interface PushSetupResult {
  status: PushSetupStatus;
  message: string;
  registrationId?: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Push notification request failed (${response.status})`);
  }
  return response.json();
}

export function getPushConfig() {
  return requestJson<PushConfigDto>('/api/push/config');
}

async function browserCanPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
  return isSupported();
}

export async function syncPushRegistration(options: { requestPermission?: boolean } = {}): Promise<PushSetupResult> {
  const config = await getPushConfig();
  if (!config.enabled || !config.configured || !config.vapidKey || !firebaseApp) {
    return { status: 'disabled', message: 'FCM push is not fully configured on the Spararama server.' };
  }
  if (!window.isSecureContext) {
    return { status: 'insecure-origin', message: 'Background push requires HTTPS (or localhost).' };
  }
  if (!(await browserCanPush())) {
    return { status: 'unsupported', message: 'This browser does not support Firebase Web Push.' };
  }

  if (Notification.permission === 'default' && options.requestPermission) {
    await Notification.requestPermission();
  }
  if (Notification.permission === 'denied') {
    return { status: 'permission-denied', message: 'Notifications are blocked for Spararama in this browser.' };
  }
  if (Notification.permission !== 'granted') {
    return { status: 'permission-required', message: 'Notification permission has not been granted yet.' };
  }

  const serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const messaging = getMessaging(firebaseApp);
  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration
  });
  if (!token) throw new Error('Firebase did not return a Web Push registration token.');

  const registration = await requestJson<{ id: string }>('/api/push/registrations', {
    method: 'POST',
    body: JSON.stringify({
      token,
      userAgent: navigator.userAgent,
      label: `${navigator.platform || 'browser'} · ${new Date().toLocaleDateString()}`
    })
  });
  localStorage.setItem(REGISTRATION_ID_KEY, registration.id);
  return { status: 'enabled', message: 'Background notifications are enabled on this device.', registrationId: registration.id };
}

export async function disablePushNotifications() {
  const registrationId = localStorage.getItem(REGISTRATION_ID_KEY);
  if (registrationId) {
    await requestJson(`/api/push/registrations/${encodeURIComponent(registrationId)}`, { method: 'DELETE' }).catch(() => undefined);
    localStorage.removeItem(REGISTRATION_ID_KEY);
  }
  if (firebaseApp && await browserCanPush()) {
    try {
      await deleteToken(getMessaging(firebaseApp));
    } catch {
      // Server-side registration is already removed; token cleanup is best effort.
    }
  }
}

export function testPushNotification() {
  return requestJson<{
    enabled: boolean;
    targetCount: number;
    successCount: number;
    failureCount: number;
    retryableFailureCount: number;
    removedInvalidCount: number;
    error?: string;
  }>('/api/push/test', { method: 'POST' });
}
