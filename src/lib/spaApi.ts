export interface SpaStatusDto {
  transport: 'mock' | 'lan' | 'cloud' | 'manual';
  connected: boolean;
  waterTemperatureC: number;
  targetTemperatureC: number;
  heaterOn: boolean;
  filterOn: boolean;
  bubblesOn: boolean;
  filterRuntimeSeconds: number;
  heaterRuntimeSeconds: number;
  updatedAt: number;
  lastContactAt?: number;
  contactFailureCount?: number;
}

async function requestSpa(path: string, init?: RequestInit): Promise<SpaStatusDto> {
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

export const spaApi = {
  status: () => requestSpa('/api/spa/status'),
  connect: () => requestSpa('/api/spa/connect', { method: 'POST' }),
  setHeater: (on: boolean) => requestSpa('/api/spa/heater', { method: 'POST', body: JSON.stringify({ on }) }),
  setFilter: (on: boolean) => requestSpa('/api/spa/filter', { method: 'POST', body: JSON.stringify({ on }) }),
  setBubbles: (on: boolean) => requestSpa('/api/spa/bubbles', { method: 'POST', body: JSON.stringify({ on }) }),
  setTargetTemperature: (celsius: number) => requestSpa('/api/spa/target-temperature', { method: 'POST', body: JSON.stringify({ celsius }) })
};
