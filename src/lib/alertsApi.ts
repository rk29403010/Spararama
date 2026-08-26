export interface AlexaAlertStatus {
  enabled: boolean;
  configured: boolean;
  device?: string;
  chimeConfigured: boolean;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Alert request failed (${response.status})`);
  }
  return response.json();
}

export const alertsApi = {
  alexaStatus: () => requestJson<AlexaAlertStatus>('/api/alerts/alexa'),
  testAlexa: () => requestJson<{ enabled: boolean; sent: boolean; error?: string }>('/api/alerts/alexa/test', { method: 'POST' })
};
