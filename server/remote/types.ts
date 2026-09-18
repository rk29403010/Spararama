import type { SpaStatus } from '../spa/types';

export const REMOTE_COMMAND_VERSION = 1 as const;

export type RemoteCommandType =
  | 'readStatus'
  | 'setTargetTemperature'
  | 'setHeater'
  | 'setFilter'
  | 'setBubbles'
  | 'createHeatingSchedule';

export interface RemoteRequestedBy {
  kind: 'user' | 'integration' | 'system';
  id: string;
}

export interface CreateHeatingSchedulePayload {
  id?: string;
  startTime: number;
  targetTime: number;
  startTemperatureC: number;
  targetTemperatureC: number;
  autoStartPreferred: boolean;
  heatSoakMinutes?: number;
  alertOnTargetReached?: boolean;
  alertOnHeatSoakComplete?: boolean;
  sessionData?: Record<string, unknown>;
}

export interface RemoteCommandPayloads {
  readStatus: Record<string, never>;
  setTargetTemperature: { celsius: number };
  setHeater: { on: boolean };
  setFilter: { on: boolean };
  setBubbles: { on: boolean; autoRestart?: boolean };
  createHeatingSchedule: CreateHeatingSchedulePayload;
}

export type RemoteCommandEnvelope<T extends RemoteCommandType = RemoteCommandType> = {
  version: typeof REMOTE_COMMAND_VERSION;
  commandId: string;
  installationId: string;
  type: T;
  payload: RemoteCommandPayloads[T];
  createdAt: number;
  expiresAt: number;
  requestedBy: RemoteRequestedBy;
};

export type RemoteCommandResultStatus = 'succeeded' | 'failed' | 'expired' | 'rejected';

export interface RemoteCommandError {
  code:
    | 'invalid_command'
    | 'wrong_installation'
    | 'expired'
    | 'spa_unavailable'
    | 'scheduler_unavailable'
    | 'unsupported_command'
    | 'execution_failed';
  message: string;
}

export interface RemoteCommandResult {
  version: typeof REMOTE_COMMAND_VERSION;
  commandId: string;
  installationId: string;
  type: string;
  status: RemoteCommandResultStatus;
  acceptedAt: number;
  completedAt: number;
  requestedBy?: RemoteRequestedBy;
  result?: unknown;
  error?: RemoteCommandError;
}

export interface InstallationPresence {
  installationId: string;
  observedAt: number;
  agentOnline: boolean;
  spaConnected?: boolean;
  spaTransport?: SpaStatus['transport'];
  backendVersion?: string;
}

export interface RemoteInstallationState {
  installationId: string;
  observedAt: number;
  spa: SpaStatus;
  activeHeatingSchedule?: {
    id: string;
    status: string;
    targetTime: number;
    targetTemperatureC: number;
  };
  capabilities?: string[];
}

export interface RemoteTransportHandlers {
  onCommand(command: RemoteCommandEnvelope): Promise<void>;
}

export interface RemoteTransportStatus {
  provider: string;
  started: boolean;
  connected: boolean;
  lastContactAt?: number;
  lastCommandAt?: number;
  lastError?: string;
}

export interface RemoteTransport {
  start(handlers: RemoteTransportHandlers): Promise<void>;
  stop(): Promise<void>;
  publishPresence(presence: InstallationPresence): Promise<void>;
  publishState(state: RemoteInstallationState): Promise<void>;
  acknowledgeCommand(result: RemoteCommandResult): Promise<void>;
  getStatus(): RemoteTransportStatus;
}
