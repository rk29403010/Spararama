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
    } | null;
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

export type CloudRemoteCommandType =
  | 'readStatus'
  | 'setTargetTemperature'
  | 'setHeater'
  | 'setFilter'
  | 'setBubbles'
  | 'scheduleReadyAt'
  | 'cancelHeatingSchedule';

export interface QueuedCloudCommand {
  commandId: string;
  installationId: string;
  type: CloudRemoteCommandType;
  status: 'queued';
  createdAt: number;
  expiresAt: number;
}

export interface CloudCommandStatus {
  commandId: string;
  installationId: string;
  type: CloudRemoteCommandType | string;
  status: 'queued' | 'claimed' | 'succeeded' | 'failed' | 'expired' | 'rejected' | string;
  createdAt: number;
  expiresAt: number;
  requestedBy?: unknown;
  payload?: unknown;
  result?: {
    status?: string;
    result?: SpaStatusDto | unknown;
    error?: { code?: string; message?: string };
  };
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

function sleep(milliseconds: number) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
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
  },

  submitCommand(
    user: User,
    installationId: string,
    type: CloudRemoteCommandType,
    payload: Record<string, unknown> = {}
  ) {
    return request<QueuedCloudCommand>(
      user,
      `/api/installations/${encodeURIComponent(installationId)}/commands`,
      {
        method: 'POST',
        body: JSON.stringify({ type, payload })
      }
    );
  },

  commandStatus(user: User, installationId: string, commandId: string) {
    return request<CloudCommandStatus>(
      user,
      `/api/installations/${encodeURIComponent(installationId)}/commands/${encodeURIComponent(commandId)}`
    );
  },

  async runCommand(
    user: User,
    installationId: string,
    type: CloudRemoteCommandType,
    payload: Record<string, unknown> = {}
  ) {
    const queued = await this.submitCommand(user, installationId, type, payload);
    const timeoutAt = queued.expiresAt + 5_000;
    let latest: CloudCommandStatus | null = null;

    while (Date.now() <= timeoutAt) {
      latest = await this.commandStatus(user, installationId, queued.commandId);
      if (['succeeded', 'failed', 'expired', 'rejected'].includes(latest.status)) {
        if (latest.status !== 'succeeded') {
          const nested = latest.result?.error?.message;
          throw new Error(nested || `Remote command ${latest.status}.`);
        }
        return latest;
      }
      await sleep(500);
    }

    throw new Error('The home Spararama server did not confirm the command before it expired.');
  }
};
