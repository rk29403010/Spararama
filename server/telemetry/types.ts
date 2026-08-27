import type { SpaStatus } from '../spa/types';
import type { DerivedWeatherReading, WeatherInfluence, WeatherSourceLocation } from '../weather/types';

export interface SensorReading {
  /** Stable metric ID, for example garden-probe-1.temperature or rain-gauge-1.total. */
  id: string;
  /** Metric kind, for example temperature, humidity, pressure, rain, solar, light or contact. */
  kind: string;
  value: number | boolean | string;
  unit?: string;
  location?: string;
  quality?: number;
  deviceId?: string;
  source?: string;
  observedAt?: number;
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
  pressureHpa?: number;
  windSpeedMps?: number;
  windDirectionDegrees?: number;
  cloudPercent?: number;
  precipitationMm?: number;
  shortwaveRadiationWm2?: number;
  observedAt?: number;
}

export type ForecastMetric =
  | 'temperatureC'
  | 'humidityPercent'
  | 'pressureHpa'
  | 'windSpeedMps'
  | 'windDirectionDegrees'
  | 'cloudPercent'
  | 'precipitationMm'
  | 'shortwaveRadiationWm2';

/** A single changed forecast value for one future timestamp. */
export interface ForecastChange {
  source: string;
  sourceLocationId?: string;
  forecastFor: number;
  metric: ForecastMetric;
  value: number | null;
  unit?: string;
}

/**
 * Legacy/materialized full sample. V1 remains the API shape used by charts and is
 * also accepted on disk so existing phone archives remain readable.
 */
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
  forecast?: ForecastChange[];
  weatherDerived?: DerivedWeatherReading;
  weatherInfluence?: WeatherInfluence;
  weatherSources?: WeatherSourceLocation[];
}

/**
 * V2 is the durable format. A snapshot establishes complete state; change records
 * contain only fields/readings which changed materially since the previous poll.
 */
export interface TelemetryEventRecord {
  schemaVersion: 2;
  id: string;
  timestamp: number;
  hostId: string;
  collectorVersion: string;
  recordKind: 'snapshot' | 'change';
  changedFields: string[];
  spa?: Partial<SpaStatus>;
  sensors?: SensorReading[];
  weather?: WeatherObservation[];
  forecast?: ForecastChange[];
  weatherDerived?: DerivedWeatherReading;
  weatherInfluence?: WeatherInfluence;
  weatherSources?: WeatherSourceLocation[];
}

export type StoredTelemetryRecord = TelemetrySample | TelemetryEventRecord;

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
