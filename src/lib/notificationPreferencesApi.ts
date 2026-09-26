import type { User } from 'firebase/auth';

export type NotificationGroup =
  | 'heating.action_required'
  | 'heating.progress'
  | 'heating.schedule'
  | 'equipment'
  | 'water_care'
  | 'system';

export type NotificationGroupPreferences = Record<NotificationGroup, boolean>;

export interface PersonalNotificationPreferences {
  push: NotificationGroupPreferences;
}

export interface SharedNotificationPreferences {
  alexa: NotificationGroupPreferences;
}

async function authHeaders(user: User, json = false) {
  const token = await user.getIdToken();
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : fallback);
  return body as T;
}

export const notificationPreferencesApi = {
  async mine(user: User) {
    const response = await fetch('/api/notification-preferences/me', {
      headers: await authHeaders(user),
      credentials: 'same-origin'
    });
    return parseResponse<PersonalNotificationPreferences>(response, 'Could not load notification preferences.');
  },

  async updateMine(user: User, push: Partial<NotificationGroupPreferences>) {
    const response = await fetch('/api/notification-preferences/me', {
      method: 'PATCH',
      headers: await authHeaders(user, true),
      credentials: 'same-origin',
      body: JSON.stringify({ push })
    });
    return parseResponse<PersonalNotificationPreferences>(response, 'Could not update notification preferences.');
  },

  async shared(user: User) {
    const response = await fetch('/api/notification-preferences/shared', {
      headers: await authHeaders(user),
      credentials: 'same-origin'
    });
    return parseResponse<SharedNotificationPreferences>(response, 'Could not load shared notification preferences.');
  },

  async updateShared(user: User, alexa: Partial<NotificationGroupPreferences>) {
    const response = await fetch('/api/notification-preferences/shared', {
      method: 'PATCH',
      headers: await authHeaders(user, true),
      credentials: 'same-origin',
      body: JSON.stringify({ alexa })
    });
    return parseResponse<SharedNotificationPreferences>(response, 'Could not update shared notification preferences.');
  }
};
