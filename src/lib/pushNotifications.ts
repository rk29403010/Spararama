import { deleteToken, getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import { auth, firebaseApp } from './firebase';

const REGISTRATION_ID_KEY = 'spararama_push_registration_id';
const DEVICE_ID_KEY = 'spararama_push_device_id';
const SERVICE_WORKER_ACTIVATION_TIMEOUT_MS = 15_000;

export interface PushConfigDto {
  enabled: boolean;
  configured: boolean;
  projectId: string;
  registrationCount: number;
  vapidKey?: string;
  browserApiKeyConfigured: boolean;
}

export interface PushRegistrationDto {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastRegisteredAt?: number;
  userUid?: string;
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  label?: string;
  lastDeliveryAttemptAt?: number;
  lastProviderAcceptedAt?: number;
  lastDeliveryErrorAt?: number;
  lastDeliveryErrorCode?: string;
  lastDeliveryErrorMessage?: string;
  consecutiveDeliveryFailures?: number;
}

export interface PushTargetDeliveryDto {
  registrationId: string;
  label?: string;
  userAgent?: string;
  success: boolean;
  invalid: boolean;
  retryable: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface PushDeliveryDto {
  enabled: boolean;
  targetCount: number;
  successCount: number;
  failureCount: number;
  retryableFailureCount: number;
  removedInvalidCount: number;
  targets: PushTargetDeliveryDto[];
  error?: string;
}

export interface ForegroundPushMessage {
  notificationId?: string;
  kind: string;
  severity: 'info' | 'warning' | 'urgent';
  title: string;
  body: string;
  url: string;
  requiresConfirmation: boolean;
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
  const user = auth?.currentUser;
  const idToken = user ? await user.getIdToken() : '';
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(init?.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Push notification request failed (${response.status})`);
  }
  return response.json();
}

function stableDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const next = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function defaultDeviceName() {
  const platform = navigator.platform || 'Browser device';
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return `Android · ${platform}`;
  if (/Windows/i.test(ua)) return `Windows · ${platform}`;
  if (/Macintosh|Mac OS/i.test(ua)) return `Mac · ${platform}`;
  if (/iPhone|iPad/i.test(ua)) return `iOS · ${platform}`;
  return platform;
}

function foregroundMessage(payload: MessagePayload): ForegroundPushMessage {
  const data = payload.data || {};
  const severity = data.severity === 'urgent' || data.severity === 'warning' ? data.severity : 'info';
  return {
    notificationId: data.notificationId || undefined,
    kind: data.kind || 'system.notification',
    severity,
    title: data.title || payload.notification?.title || 'Spararama',
    body: data.body || payload.notification?.body || '',
    url: data.url || '/',
    requiresConfirmation: data.requiresConfirmation === 'true'
  };
}

export function getPushConfig() {
  return requestJson<PushConfigDto>('/api/push/config');
}

export function listPushRegistrations() {
  return requestJson<{ registrations: PushRegistrationDto[] }>('/api/push/registrations');
}

export function currentPushRegistrationId() {
  try { return localStorage.getItem(REGISTRATION_ID_KEY); } catch { return null; }
}

export function currentPushDeviceId() {
  return stableDeviceId();
}

async function browserCanPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
  return isSupported();
}

/**
 * Firebase routes foreground messages to the page rather than the service worker.
 * Keep one page-level listener so a test or real alert is visible while Spararama
 * is open, while the generated service worker continues to own background/locked
 * delivery.
 */
export function subscribeToForegroundPush(listener: (message: ForegroundPushMessage) => void) {
  if (!firebaseApp || typeof window === 'undefined') return () => {};
  try {
    return onMessage(getMessaging(firebaseApp), payload => listener(foregroundMessage(payload)));
  } catch (error) {
    console.warn('Could not start foreground Firebase messaging listener', error);
    return () => {};
  }
}

export async function waitForActiveServiceWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs = SERVICE_WORKER_ACTIVATION_TIMEOUT_MS
) {
  if (registration.active?.state === 'activated') return registration;

  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker) throw new Error('Firebase push service worker did not start installing.');

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      worker.removeEventListener('statechange', checkState);
      if (timer) clearTimeout(timer);
    };
    const checkState = () => {
      if (registration.active?.state === 'activated' || worker.state === 'activated') {
        cleanup();
        resolve();
      } else if (worker.state === 'redundant') {
        cleanup();
        reject(new Error('Firebase push service worker became redundant before activation.'));
      }
    };

    worker.addEventListener('statechange', checkState);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Firebase push service worker did not activate in time.'));
    }, timeoutMs);
    checkState();
  });

  return registration;
}

export async function syncPushRegistration(options: { requestPermission?: boolean } = {}): Promise<PushSetupResult> {
  // Notification permission must be requested while the browser still considers
  // this call part of the user's click/tap. In particular, mobile Chrome can
  // drop transient user activation if we await network/Firebase work first.
  if (!firebaseApp) {
    return { status: 'disabled', message: 'Firebase is not configured in this Spararama browser build.' };
  }
  if (!window.isSecureContext) {
    return { status: 'insecure-origin', message: 'Background push requires HTTPS (or localhost).' };
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return { status: 'unsupported', message: 'This browser does not support background notifications.' };
  }

  let permission = Notification.permission;
  if (permission === 'default' && options.requestPermission) {
    permission = await Notification.requestPermission();
  }
  if (permission === 'denied') {
    return { status: 'permission-denied', message: 'Notifications are blocked for Spararama in this browser.' };
  }
  if (permission !== 'granted') {
    return { status: 'permission-required', message: 'Notification permission has not been granted yet.' };
  }

  const config = await getPushConfig();
  if (!config.enabled || !config.configured || !config.vapidKey) {
    return { status: 'disabled', message: 'FCM push is not fully configured on the Spararama server.' };
  }
  if (!(await browserCanPush())) {
    return { status: 'unsupported', message: 'This browser does not support Firebase Web Push.' };
  }

  if (!auth?.currentUser) throw new Error('Sign in to enable push notifications on this device.');

  const serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
    scope: '/firebase-cloud-messaging-push-scope'
  });
  await waitForActiveServiceWorker(serviceWorkerRegistration);

  const messaging = getMessaging(firebaseApp);
  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration
  });
  if (!token) throw new Error('Firebase did not return a Web Push registration token.');

  const deviceId = stableDeviceId();
  const deviceName = defaultDeviceName();
  const registration = await requestJson<{ id: string }>('/api/push/registrations', {
    method: 'POST',
    body: JSON.stringify({
      token,
      deviceId,
      deviceName,
      userAgent: navigator.userAgent,
      label: `${deviceName} · ${new Date().toLocaleDateString()}`
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

export function renamePushRegistration(registrationId: string, deviceName: string) {
  return requestJson<PushRegistrationDto>(`/api/push/registrations/${encodeURIComponent(registrationId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ deviceName })
  });
}

export async function removePushRegistration(registrationId: string) {
  const result = await requestJson<{ removed: boolean }>(`/api/push/registrations/${encodeURIComponent(registrationId)}`, { method: 'DELETE' });
  if (registrationId === currentPushRegistrationId()) {
    try { localStorage.removeItem(REGISTRATION_ID_KEY); } catch { /* optional */ }
  }
  return result;
}

export function testPushNotification() {
  return requestJson<PushDeliveryDto>('/api/push/test', { method: 'POST' });
}

export function testPushRegistration(registrationId: string) {
  return requestJson<PushDeliveryDto>(`/api/push/registrations/${encodeURIComponent(registrationId)}/test`, { method: 'POST' });
}
