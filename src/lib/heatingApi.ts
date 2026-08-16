import type { HeatingSession } from '../types';

export type HeatingScheduleStatus = 'scheduled' | 'retrying' | 'running-remote' | 'awaiting-manual-confirmation' | 'running-manual' | 'cancelled';

export interface HeatingScheduleDto {
  id: string;
  createdAt: number;
  updatedAt: number;
  startTime: number;
  targetTime: number;
  startTemperatureC: number;
  targetTemperatureC: number;
  autoStartPreferred: boolean;
  status: HeatingScheduleStatus;
  attempts: number;
  nextAttemptAt?: number;
  remoteStartedAt?: number;
  manualStartedAt?: number;
  manualStartTemperatureC?: number;
  lastError?: string;
}

export interface HeatingNotificationDto {
  id: string;
  scheduleId: string;
  kind: 'heater_started' | 'manual_start_required';
  createdAt: number;
  title: string;
  message: string;
  requiresConfirmation: boolean;
  deliveredAt?: number;
  resolvedAt?: number;
  pushSentAt?: number;
  pushAttempts?: number;
  pushLastAttemptAt?: number;
  pushNextAttemptAt?: number;
  pushLastError?: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Heating request failed (${response.status})`);
  }
  return response.json();
}

export const heatingApi = {
  schedule: (session: HeatingSession, autoStartPreferred: boolean) => requestJson<HeatingScheduleDto>('/api/heating/schedules', {
    method: 'POST',
    body: JSON.stringify({
      id: session.id,
      startTime: session.startTime,
      targetTime: session.targetTime,
      startTemperatureC: session.startTemp,
      targetTemperatureC: session.targetTemp,
      autoStartPreferred,
      sessionData: session
    })
  }),
  notifications: () => requestJson<{ notifications: HeatingNotificationDto[] }>('/api/heating/notifications'),
  markDelivered: (id: string) => requestJson<HeatingNotificationDto>(`/api/heating/notifications/${encodeURIComponent(id)}/delivered`, { method: 'POST' }),
  confirmManualStart: (scheduleId: string, temperatureC?: number) => requestJson<HeatingScheduleDto>(`/api/heating/schedules/${encodeURIComponent(scheduleId)}/confirm-manual`, {
    method: 'POST',
    body: JSON.stringify({ temperatureC })
  })
};
