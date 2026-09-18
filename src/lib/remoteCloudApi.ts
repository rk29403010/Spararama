import type { User } from 'firebase/auth';
import type { SpaStatusDto } from './spaApi';
import { cloudApiBaseUrl } from './runtime';

export interface CloudInstallationSummary {
  installationId: string;
  role: 'owner' | 'member' | 'viewer';
  name?: string;
}

export interface CloudRuntimeSnapshot {
  heartbeatAtMs?: number;
  statePublishedAtMs?: number;
  presence?: {
    installationId?: string;
    observedAt?: number;
    agentOnline?: boolean;
    spaConnected?: boolean;
    spaTransport?: string;
  };
  state?: {
    installationId?: string;
    observedAt?: number;
    spa?: SpaStatusDto;
    activeHeatingSchedule?: {
      id: string;
      status: string;
      targetTime: number;
      targetTemperatureC: number;
    };
    capabilities?: string[];
  };
}

export interface CloudInstallationState {
  installationId: string;
  role: 'owner' | 'member' | 'viewer';
  name?: string;
  freshness: {
    status: 'fresh' | 'stale' | 'offline';
    ageMs: number | null;
  };
  runtime: CloudRuntimeSnapshot | null;
}

async function request<T>(user: User, path: string, init?: RequestInit): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`${cloudApiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {})
    }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === 'string'
      ? body.message
      : `Remote request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export const remoteCloudApi = {
  async installations(user: User) {
    const response = await request<{ installations: CloudInstallationSummary[] }>(user, '/api/installations');
    return response.installations;
  },

  state(user: User, installationId: string) {
    return request<CloudInstallationState>(
      user,
      `/api/installations/${encodeURIComponent(installationId)}/state`
    );
  }
};
