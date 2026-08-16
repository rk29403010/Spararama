export type WeatherSamplingMode = 'nearest' | 'triangulate';
export type WeatherInstallation = 'indoor' | 'outdoor';
export type WindExposure = 'sheltered' | 'normal' | 'exposed';
export type SolarExposure = 'shade' | 'mixed' | 'sun-trap';

export interface WeatherLocation {
  latitude: number;
  longitude: number;
  label?: string;
  source: 'phone' | 'lookup' | 'manual';
}

export interface WeatherTweaks {
  installation: WeatherInstallation;
  windExposure: WindExposure;
  solarExposure: SolarExposure;
  overallInfluencePercent: number;
}

export interface WeatherSettings {
  location?: WeatherLocation;
  samplingMode: WeatherSamplingMode;
  triangulationRadiusKm: number;
  tweaks: WeatherTweaks;
}

export interface WeatherInfluence {
  overall: number;
  temperature: number;
  wind: number;
  solar: number;
  precipitation: number;
}

export interface WeatherSourceLocation {
  id: string;
  provider: 'open-meteo';
  requestedLatitude: number;
  requestedLongitude: number;
  resolvedLatitude?: number;
  resolvedLongitude?: number;
  label: string;
}

export interface RawWeatherReading {
  source: string;
  station?: string;
  provider: 'open-meteo';
  sourceLocationId: string;
  latitude?: number;
  longitude?: number;
  temperatureC?: number;
  humidityPercent?: number;
  windSpeedMps?: number;
  windDirectionDegrees?: number;
  cloudPercent?: number;
  precipitationMm?: number;
  shortwaveRadiationWm2?: number;
  observedAt?: number;
}

export interface DerivedWeatherReading {
  method: 'single' | 'mean';
  sourceCount: number;
  sourceLocationIds: string[];
  temperatureC?: number;
  humidityPercent?: number;
  windSpeedMps?: number;
  windDirectionDegrees?: number;
  cloudPercent?: number;
  precipitationMm?: number;
  shortwaveRadiationWm2?: number;
  observedAt?: number;
}

export interface CurrentWeatherSnapshot {
  settings: WeatherSettings;
  influence: WeatherInfluence;
  sources: WeatherSourceLocation[];
  raw: RawWeatherReading[];
  derived: DerivedWeatherReading;
}

export interface WeatherForecastSeries {
  time: number[];
  temperatureC: Array<number | null>;
  windSpeedMps: Array<number | null>;
  cloudPercent: Array<number | null>;
  precipitationMm: Array<number | null>;
  shortwaveRadiationWm2: Array<number | null>;
}

export interface WeatherForecastSnapshot {
  settings: WeatherSettings;
  influence: WeatherInfluence;
  sources: WeatherSourceLocation[];
  raw: Array<{ sourceLocationId: string; series: WeatherForecastSeries }>;
  derived: WeatherForecastSeries;
}
