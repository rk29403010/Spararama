import type { SpaStatusDto } from './spaApi';
import type { EquipmentCatalogResponse } from '../domain/equipmentCatalog';

export interface WeatherObservationDto {
  source: string;
  station?: string;
  temperatureC?: number;
  humidityPercent?: number;
  windSpeedMps?: number;
  cloudPercent?: number;
  precipitationMm?: number;
  observedAt?: number;
}

export interface TelemetrySampleDto {
  schemaVersion: 1;
  id: string;
  timestamp: number;
  hostId: string;
  collectorVersion: string;
  spa: SpaStatusDto;
  changedFields: string[];
  weather?: WeatherObservationDto[];
}

export interface TelemetryHistoryDto { samples: TelemetrySampleDto[]; total: number; }
export interface TelemetryChartDto { samples: TelemetrySampleDto[]; rawTotal: number; rolledUp: boolean; }
export interface TelemetryStatusDto {
  running: boolean;
  pendingUploads: number;
  firebaseEnabled: boolean;
  lastUploadAt?: number;
  lastError?: string;
  equipmentCatalog?: EquipmentCatalogResponse;
}
export interface TelemetryConfigDto { intervalSeconds: number; }

async function requestTelemetry<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const body = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
    throw new Error(body.error || `Telemetry request failed (${response.status})`);
  }
  if (!contentType.includes('application/json')) {
    throw new Error('The Spararama backend is older than the page currently loaded. Restart or update the local app so the UI and backend use the same build.');
  }
  return response.json();
}

async function updateTelemetry<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({}));
    throw new Error(responseBody.error || `Telemetry update failed (${response.status})`);
  }
  return response.json();
}

export const telemetryApi = {
  history: (limit = 200) => requestTelemetry<TelemetryHistoryDto>(`/api/telemetry/samples?limit=${limit}`),
  chart: (since: number, maxPoints = 500) => requestTelemetry<TelemetryChartDto>(`/api/telemetry/chart?since=${Math.floor(since)}&maxPoints=${Math.floor(maxPoints)}`),
  status: () => requestTelemetry<TelemetryStatusDto>('/api/telemetry/status'),
  config: () => requestTelemetry<TelemetryConfigDto>('/api/telemetry/config'),
  updateConfig: (intervalSeconds: number) => updateTelemetry<TelemetryConfigDto>('/api/telemetry/config', { intervalSeconds })
};
