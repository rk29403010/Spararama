import type { HeatingSession } from '../types';

export type HeatingScheduleStatus = 'scheduled' | 'retrying' | 'running-remote' | 'awaiting-manual-confirmation' | 'running-manual' | 'ready' | 'cancelled';

export interface HeatingScheduleDto {
  id: string;
  createdAt: number;
  updatedAt: number;
  startTime: number;
  targetTime: number;
  startTemperatureC: number;
  targetTemperatureC: number;
  autoStartPreferred: boolean;
  heatSoakMinutes: number;
  alertOnTargetReached: boolean;
  alertOnHeatSoakComplete: boolean;
  status: HeatingScheduleStatus;
  attempts: number;
  nextAttemptAt?: number;
  remoteStartedAt?: number;
  manualStartedAt?: number;
  manualStartTemperatureC?: number;
  targetReachedAt?: number;
  soakStartedAt?: number;
  heatSoakCompletedAt?: number;
  lastObservedTemperatureC?: number;
  lastError?: string;
}

export interface HeatingNotificationDto {
  id: string;
  scheduleId: string;
  kind: 'heater_started' | 'manual_start_required' | 'target_reached' | 'heat_soak_complete';
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

export interface HeatingAlertOptions {
  heatSoakMinutes: number;
  alertOnTargetReached: boolean;
  alertOnHeatSoakComplete: boolean;
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
  schedule: (session: HeatingSession, autoStartPreferred: boolean, alerts: HeatingAlertOptions) => requestJson<HeatingScheduleDto>('/api/heating/schedules', {
    method: 'POST',
    body: JSON.stringify({
      id: session.id,
      startTime: session.startTime,
      targetTime: session.targetTime,
      startTemperatureC: session.startTemp,
      targetTemperatureC: session.targetTemp,
      autoStartPreferred,
      heatSoakMinutes: alerts.heatSoakMinutes,
      alertOnTargetReached: alerts.alertOnTargetReached,
      alertOnHeatSoakComplete: alerts.alertOnHeatSoakComplete,
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
