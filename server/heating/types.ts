export type HeatingScheduleStatus =
  | 'scheduled'
  | 'retrying'
  | 'running-remote'
  | 'awaiting-manual-confirmation'
  | 'running-manual'
  | 'cancelled';

export interface HeatingSchedule {
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
  sessionData?: Record<string, unknown>;
}

export type HeatingNotificationKind = 'heater_started' | 'manual_start_required';

export interface HeatingNotification {
  id: string;
  scheduleId: string;
  kind: HeatingNotificationKind;
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

export interface HeatingEvent {
  id: string;
  scheduleId: string;
  timestamp: number;
  type: 'scheduled' | 'remote_start_attempt' | 'remote_started' | 'remote_start_failed' | 'manual_start_requested' | 'manual_started';
  details?: Record<string, unknown>;
}
