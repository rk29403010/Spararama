import { auth } from './firebase';

export type NotificationSeverity = 'info' | 'warning' | 'urgent';
export type NotificationGroup =
  | 'heating.action_required'
  | 'heating.progress'
  | 'heating.schedule'
  | 'equipment'
  | 'water_care'
  | 'system';

export type NotificationGroupPreferences = Record<NotificationGroup, boolean>;

export interface SpararamaNotificationDto {
  id: string;
  type: string;
  group: NotificationGroup;
  severity: NotificationSeverity;
  title: string;
  message: string;
  createdAt: number;
  updatedAt: number;
  incidentKey?: string;
  context?: Record<string, unknown>;
  requiresAcknowledgement: boolean;
  acknowledgedAt?: number;
  resolvedAt?: number;
}

export interface PersonalNotificationPreferencesDto {
  push: NotificationGroupPreferences;
}

export interface SharedNotificationPreferencesDto {
  alexa: NotificationGroupPreferences;
}

async function authenticatedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in to manage notification settings.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Notification request failed (${response.status}).`);
  return body as T;
}

export async function listActiveNotifications() {
  const response = await fetch('/api/notifications', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Notification request failed (${response.status}).`);
  return response.json() as Promise<{ notifications: SpararamaNotificationDto[] }>;
}

export function getPersonalNotificationPreferences() {
  return authenticatedJson<PersonalNotificationPreferencesDto>('/api/notification-preferences/me');
}

export function updatePersonalNotificationPreferences(push: Partial<NotificationGroupPreferences>) {
  return authenticatedJson<PersonalNotificationPreferencesDto>('/api/notification-preferences/me', {
    method: 'PATCH',
    body: JSON.stringify({ push })
  });
}

export function getSharedNotificationPreferences() {
  return authenticatedJson<SharedNotificationPreferencesDto>('/api/notification-preferences/shared');
}

export function updateSharedNotificationPreferences(alexa: Partial<NotificationGroupPreferences>) {
  return authenticatedJson<SharedNotificationPreferencesDto>('/api/notification-preferences/shared', {
    method: 'PATCH',
    body: JSON.stringify({ alexa })
  });
}
