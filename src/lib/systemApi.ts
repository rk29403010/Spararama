export type SystemUpdateRunState = 'idle' | 'running' | 'succeeded' | 'failed';

export interface SystemUpdateStatusDto {
  supported: boolean;
  reason?: string;
  branch?: string;
  currentBranch?: string;
  commit?: string;
  dirty?: boolean;
  update: {
    state: SystemUpdateRunState;
    startedAt?: number;
    finishedAt?: number;
    exitCode?: number;
    message?: string;
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `System request failed (${response.status})`);
  }
  return response.json();
}

export const systemApi = {
  updateStatus: () => requestJson<SystemUpdateStatusDto>('/api/system/update'),
  updateAndRestart: () => requestJson<SystemUpdateStatusDto>('/api/system/update', {
    method: 'POST',
    headers: { 'x-spararama-developer': 'update-restart' }
  })
};
