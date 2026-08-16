export type WeatherSamplingMode = 'nearest' | 'triangulate';
export type WeatherInstallation = 'indoor' | 'outdoor';
export type WindExposure = 'sheltered' | 'normal' | 'exposed';
export type SolarExposure = 'shade' | 'mixed' | 'sun-trap';

export interface WeatherLocationDto {
  latitude: number;
  longitude: number;
  label?: string;
  source: 'phone' | 'lookup' | 'manual';
}

export interface WeatherSettingsDto {
  location?: WeatherLocationDto;
  samplingMode: WeatherSamplingMode;
  triangulationRadiusKm: number;
  tweaks: {
    installation: WeatherInstallation;
    windExposure: WindExposure;
    solarExposure: SolarExposure;
    overallInfluencePercent: number;
  };
}

export interface WeatherInfluenceDto {
  overall: number;
  temperature: number;
  wind: number;
  solar: number;
  precipitation: number;
}

export interface WeatherLookupResultDto {
  id: string;
  name: string;
  admin1?: string;
  admin2?: string;
  country?: string;
  postcodes?: string[];
  latitude: number;
  longitude: number;
  timezone?: string;
}

export interface WeatherForecastSeriesDto {
  time: number[];
  temperatureC: Array<number | null>;
  windSpeedMps: Array<number | null>;
  cloudPercent: Array<number | null>;
  precipitationMm: Array<number | null>;
  shortwaveRadiationWm2: Array<number | null>;
}

export interface WeatherForecastDto {
  settings: WeatherSettingsDto;
  influence: WeatherInfluenceDto;
  sources: Array<{
    id: string;
    provider: string;
    requestedLatitude: number;
    requestedLongitude: number;
    resolvedLatitude?: number;
    resolvedLongitude?: number;
    label: string;
  }>;
  raw: Array<{ sourceLocationId: string; series: WeatherForecastSeriesDto }>;
  derived: WeatherForecastSeriesDto;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Weather request failed (${response.status})`);
  }
  return response.json();
}

export const weatherApi = {
  config: () => requestJson<WeatherSettingsDto>('/api/weather/config'),
  saveConfig: (settings: WeatherSettingsDto) => requestJson<WeatherSettingsDto>('/api/weather/config', { method: 'PUT', body: JSON.stringify(settings) }),
  lookup: (query: string) => requestJson<WeatherLookupResultDto[]>(`/api/weather/lookup?q=${encodeURIComponent(query)}`),
  forecast: (days = 2) => requestJson<WeatherForecastDto>(`/api/weather/forecast?days=${days}`)
};
