import type { SpaStatusDto } from './spaApi';

export interface TelemetrySampleDto {
  schemaVersion: 1;
  id: string;
  timestamp: number;
  hostId: string;
  collectorVersion: string;
  spa: SpaStatusDto;
  changedFields: string[];
}

export interface TelemetryHistoryDto {
  samples: TelemetrySampleDto[];
  total: number;
}

export interface TelemetryStatusDto {
  running: boolean;
  pendingUploads: number;
  firebaseEnabled: boolean;
  lastUploadAt?: number;
  lastError?: string;
}

export interface TelemetryConfigDto {
  intervalSeconds: number;
}

async function requestTelemetry<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Telemetry request failed (${response.status})`);
  }
  return response.json();
}

async function updateTelemetry<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({}));
    throw new Error(responseBody.error || `Telemetry update failed (${response.status})`);
  }
  return response.json();
}

export const telemetryApi = {
  history: (limit = 200) => requestTelemetry<TelemetryHistoryDto>(`/api/telemetry/samples?limit=${limit}`),
  status: () => requestTelemetry<TelemetryStatusDto>('/api/telemetry/status'),
  config: () => requestTelemetry<TelemetryConfigDto>('/api/telemetry/config'),
  updateConfig: (intervalSeconds: number) => updateTelemetry<TelemetryConfigDto>('/api/telemetry/config', { intervalSeconds })
};
