import { auth } from './firebase';

export interface AlexaAlertStatus {
  enabled: boolean;
  configured: boolean;
  device?: string;
  chimeConfigured: boolean;
  source: 'secret-manager' | 'environment' | 'none';
  secretId: string;
  storageError?: string;
}

export interface AlexaAlertSettingsInput {
  enabled?: boolean;
  token?: string;
  device?: string;
  chime?: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = auth?.currentUser ? await auth.currentUser.getIdToken() : '';
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Alert request failed (${response.status})`);
  }
  return response.json();
}

export const alertsApi = {
  alexaStatus: () => requestJson<AlexaAlertStatus>('/api/alerts/alexa'),
  updateAlexa: (settings: AlexaAlertSettingsInput) => requestJson<AlexaAlertStatus>('/api/alerts/alexa', {
    method: 'PUT',
    body: JSON.stringify(settings)
  }),
  testAlexa: () => requestJson<{ enabled: boolean; sent: boolean; error?: string }>('/api/alerts/alexa/test', { method: 'POST' })
};
