export type TemperatureConfidence = 'high' | 'medium' | 'low';

export interface BestEffortTemperatureDto {
  valueC: number;
  confidence: TemperatureConfidence;
  confidenceScore: number;
  source: 'live-spa' | 'recent-telemetry' | 'last-known-water' | 'ambient-sensor' | 'weather' | 'ambient-default';
  observedAt: number;
  estimated: boolean;
  ageMs: number;
  reason: string;
}

export interface BubbleSessionDto {
  bubblePhase: 'idle' | 'running' | 'cooldown';
  bubbleRunLimitSeconds: number | null;
  bubbleCooldownSeconds: number | null;
  bubbleTimingKnown: boolean;
  bubbleStartedAt?: number;
  bubbleRunEndsAt?: number;
  bubbleCooldownEndsAt?: number;
  bubbleAutoRestartEnabled: boolean;
  bubbleAutoRestartUsed: boolean;
}

export interface SpaStatusDto extends Partial<BubbleSessionDto> {
  transport: 'mock' | 'lan' | 'cloud' | 'manual';
  connected: boolean;
  waterTemperatureC: number | null;
  waterTemperatureConfidence?: TemperatureConfidence;
  waterTemperatureConfidenceScore?: number;
  waterTemperatureSource?: BestEffortTemperatureDto['source'];
  waterTemperatureObservedAt?: number;
  waterTemperatureEstimated?: boolean;
  waterTemperatureReason?: string;
  targetTemperatureC: number | null;
  heaterOn: boolean;
  filterOn: boolean;
  bubblesOn: boolean;
  filterRuntimeSeconds: number;
  heaterRuntimeSeconds: number;
  updatedAt: number;
  lastContactAt?: number;
  contactFailureCount?: number;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Spa request failed (${response.status})`);
  }
  return response.json();
}

function requestSpa(path: string, init?: RequestInit) {
  return requestJson<SpaStatusDto>(path, init);
}

export const spaApi = {
  status: () => requestSpa('/api/spa/status'),
  currentTemperature: () => requestJson<BestEffortTemperatureDto>('/api/spa/current-temperature'),
  connect: () => requestSpa('/api/spa/connect', { method: 'POST' }),
  setHeater: (on: boolean) => requestSpa('/api/spa/heater', { method: 'POST', body: JSON.stringify({ on }) }),
  setFilter: (on: boolean) => requestSpa('/api/spa/filter', { method: 'POST', body: JSON.stringify({ on }) }),
  setBubbles: (on: boolean, autoRestart = false) => requestSpa('/api/spa/bubbles', { method: 'POST', body: JSON.stringify({ on, autoRestart }) }),
  setBubbleAutoRestart: (enabled: boolean) => requestJson<BubbleSessionDto>('/api/spa/bubbles/auto-restart', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  setTargetTemperature: (celsius: number) => requestSpa('/api/spa/target-temperature', { method: 'POST', body: JSON.stringify({ celsius }) })
};
