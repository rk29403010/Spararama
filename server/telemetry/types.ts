import type { SpaStatus } from '../spa/types';
import type { DerivedWeatherReading, WeatherInfluence, WeatherSourceLocation } from '../weather/types';

export interface SensorReading {
  id: string;
  kind: string;
  value: number | boolean | string;
  unit?: string;
  location?: string;
  quality?: number;
}

export interface WeatherObservation {
  source: string;
  station?: string;
  provider?: string;
  sourceLocationId?: string;
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

export interface TelemetrySample {
  schemaVersion: 1;
  id: string;
  timestamp: number;
  hostId: string;
  collectorVersion: string;
  spa: SpaStatus;
  changedFields: string[];
  sensors: SensorReading[];
  weather: WeatherObservation[];
  weatherDerived?: DerivedWeatherReading;
  weatherInfluence?: WeatherInfluence;
  weatherSources?: WeatherSourceLocation[];
}

export interface TelemetryCollectorStatus {
  running: boolean;
  intervalMs: number;
  samplesCollected: number;
  pendingUploads: number;
  lastSampleAt?: number;
  lastUploadAt?: number;
  lastError?: string;
  localArchivePath: string;
  firebaseEnabled: boolean;
  firebaseProjectId?: string;
  firestoreDatabaseId?: string;
  firebaseCredentialSource?: string;
}
