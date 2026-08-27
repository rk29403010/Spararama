import os from 'node:os';
import type { SpaAdapter, SpaStatus } from '../spa/types';
import { LocalTelemetryStore } from './local-store';
import { FirebaseTelemetrySink } from './firebase-sink';
import type {
  ForecastChange,
  ForecastMetric,
  SensorReading,
  StoredTelemetryRecord,
  TelemetryCollectorStatus,
  TelemetryEventRecord,
  WeatherObservation
} from './types';
import { EquipmentCatalogStore } from '../catalog/store';
import { EQUIPMENT_CATALOG_SEED, type EquipmentCatalogResponse } from '../../src/domain/equipmentCatalog';
import type { WeatherService } from '../weather/service';
import type { CurrentWeatherSnapshot, WeatherForecastSnapshot } from '../weather/types';

interface TelemetrySink {
  enabled: boolean;
  config?: { projectId: string; databaseId: string; credentialSource: string; };
  writeSamples(samples: StoredTelemetryRecord[]): Promise<void>;
}

export interface TelemetrySensorSource {
  read(): Promise<SensorReading[]>;
}

const SPA_EVENT_FIELDS: Array<keyof SpaStatus> = [
  'connected', 'waterTemperatureC', 'targetTemperatureC', 'heaterOn', 'filterOn', 'bubblesOn', 'transport', 'deviceFilterMinutes'
];
const WEATHER_NUMERIC_FIELDS: Array<keyof WeatherObservation> = [
  'latitude', 'longitude', 'temperatureC', 'humidityPercent', 'pressureHpa', 'windSpeedMps', 'windDirectionDegrees',
  'cloudPercent', 'precipitationMm', 'shortwaveRadiationWm2'
];
const FORECAST_METRICS: ForecastMetric[] = [
  'temperatureC', 'windSpeedMps', 'cloudPercent', 'precipitationMm', 'shortwaveRadiationWm2'
];

function safeHostId() {
  return (process.env.TELEMETRY_HOST_ID || os.hostname() || 'spararama-host').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numericChanged(previous: unknown, current: unknown, deadband = 0) {
  if (!finite(previous) || !finite(current)) return !Object.is(previous, current);
  return Math.abs(current - previous) >= deadband;
}

function directionChanged(previous: unknown, current: unknown, deadband: number) {
  if (!finite(previous) || !finite(current)) return !Object.is(previous, current);
  const difference = Math.abs((((current - previous) + 540) % 360) - 180);
  return difference >= deadband;
}

function sensorDeadband(kind: string) {
  const metric = kind.toLowerCase();
  if (metric.includes('temp')) return 0.1;
  if (metric.includes('humid')) return 1;
  if (metric.includes('press')) return 0.5;
  if (metric.includes('rain') || metric.includes('precip')) return 0.1;
  if (metric.includes('solar') || metric.includes('irradi') || metric.includes('light')) return 10;
  if (metric.includes('wind')) return 0.2;
  return 0;
}

function weatherDeadband(field: keyof WeatherObservation) {
  switch (field) {
    case 'latitude': case 'longitude': return 0.0001;
    case 'temperatureC': return 0.1;
    case 'humidityPercent': return 1;
    case 'pressureHpa': return 0.5;
    case 'windSpeedMps': return 0.2;
    case 'windDirectionDegrees': return 5;
    case 'cloudPercent': return 5;
    case 'precipitationMm': return 0.1;
    case 'shortwaveRadiationWm2': return 10;
    default: return 0;
  }
}

function forecastDeadband(metric: ForecastMetric) {
  switch (metric) {
    case 'temperatureC': return 0.2;
    case 'humidityPercent': return 2;
    case 'pressureHpa': return 1;
    case 'windSpeedMps': return 0.3;
    case 'windDirectionDegrees': return 10;
    case 'cloudPercent': return 5;
    case 'precipitationMm': return 0.1;
    case 'shortwaveRadiationWm2': return 15;
  }
}

function spaChanges(previous: SpaStatus | null, current: SpaStatus) {
  const patch: Partial<SpaStatus> = {};
  const fields: string[] = [];
  if (!previous) return { patch: { ...current }, fields: ['initial'] };
  for (const field of SPA_EVENT_FIELDS) {
    const changed = field === 'waterTemperatureC'
      ? numericChanged(previous[field], current[field], 0.1)
      : !Object.is(previous[field], current[field]);
    if (!changed) continue;
    (patch as any)[field] = current[field];
    fields.push(`spa.${String(field)}`);
  }
  return { patch, fields };
}

function weatherKey(reading: WeatherObservation) {
  return reading.sourceLocationId || reading.station || reading.source;
}

function weatherChanges(previous: Map<string, WeatherObservation>, current: WeatherObservation[]) {
  const changed: WeatherObservation[] = [];
  const fields: string[] = [];
  for (const reading of current) {
    const key = weatherKey(reading);
    const before = previous.get(key);
    if (!before) {
      changed.push({ ...reading });
      for (const field of WEATHER_NUMERIC_FIELDS) {
        if (reading[field] !== undefined) fields.push(`weather.${key}.${String(field)}`);
      }
      previous.set(key, { ...reading });
      continue;
    }

    const patch: WeatherObservation = {
      source: reading.source,
      provider: reading.provider,
      sourceLocationId: reading.sourceLocationId,
      station: reading.station
    };
    let hasChange = false;
    for (const field of WEATHER_NUMERIC_FIELDS) {
      const isDirection = field === 'windDirectionDegrees';
      const fieldChanged = isDirection
        ? directionChanged(before[field], reading[field], weatherDeadband(field))
        : numericChanged(before[field], reading[field], weatherDeadband(field));
      if (!fieldChanged) continue;
      (patch as any)[field] = reading[field];
      fields.push(`weather.${key}.${String(field)}`);
      hasChange = true;
    }
    if (hasChange) {
      patch.observedAt = reading.observedAt;
      changed.push(patch);
    }
    previous.set(key, { ...reading });
  }
  return { changed, fields };
}

function sensorChanges(previous: Map<string, SensorReading>, current: SensorReading[]) {
  const changed: SensorReading[] = [];
  const fields: string[] = [];
  for (const reading of current) {
    const before = previous.get(reading.id);
    let hasChange = !before;
    if (before) {
      if (typeof reading.value === 'number' && typeof before.value === 'number') {
        hasChange = numericChanged(before.value, reading.value, sensorDeadband(reading.kind));
      } else {
        hasChange = !Object.is(before.value, reading.value);
      }
    }
    if (hasChange) {
      changed.push({ ...reading });
      fields.push(`sensor.${reading.id}`);
    }
    previous.set(reading.id, { ...reading });
  }
  return { changed, fields };
}

function forecastUnit(metric: ForecastMetric) {
  switch (metric) {
    case 'temperatureC': return 'C';
    case 'humidityPercent': case 'cloudPercent': return '%';
    case 'pressureHpa': return 'hPa';
    case 'windSpeedMps': return 'm/s';
    case 'windDirectionDegrees': return 'deg';
    case 'precipitationMm': return 'mm';
    case 'shortwaveRadiationWm2': return 'W/m2';
  }
}

function flattenForecast(snapshot: WeatherForecastSnapshot): ForecastChange[] {
  const series = snapshot.derived;
  const output: ForecastChange[] = [];
  for (let index = 0; index < series.time.length; index += 1) {
    const forecastFor = series.time[index];
    if (!finite(forecastFor)) continue;
    for (const metric of FORECAST_METRICS) {
      const values = (series as any)[metric] as Array<number | null> | undefined;
      if (!values) continue;
      const value = values[index] ?? null;
      output.push({ source: 'open-meteo-derived', forecastFor, metric, value, unit: forecastUnit(metric) });
    }
  }
  return output;
}

function forecastKey(change: ForecastChange) {
  return `${change.sourceLocationId || change.source}:${change.forecastFor}:${change.metric}`;
}

export class TelemetryCollector {
  private intervalMs: number;
  private readonly hostId = safeHostId();
  private readonly collectorVersion = process.env.SPARARAMA_COLLECTOR_VERSION || '0.2.0';
  private readonly snapshotIntervalMs: number;
  private readonly forecastIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();
  private previousSpa: SpaStatus | null = null;
  private previousWeather = new Map<string, WeatherObservation>();
  private previousSensors = new Map<string, SensorReading>();
  private previousForecast = new Map<string, ForecastChange>();
  private lastSnapshotAt = 0;
  private lastForecastPollAt = 0;
  private status: TelemetryCollectorStatus;
  private equipmentCatalog: EquipmentCatalogResponse = { source: 'seed', models: [...EQUIPMENT_CATALOG_SEED] };

  constructor(
    private readonly spa: SpaAdapter,
    private readonly store = new LocalTelemetryStore(),
    private readonly firebase: TelemetrySink = new FirebaseTelemetrySink(),
    private readonly weather?: WeatherService,
    private readonly sensorSource?: TelemetrySensorSource
  ) {
    const configured = Number(process.env.TELEMETRY_INTERVAL_SECONDS || 300);
    this.intervalMs = Math.max(60, Number.isFinite(configured) ? configured : 300) * 1000;
    const snapshotSeconds = Number(process.env.TELEMETRY_SNAPSHOT_INTERVAL_SECONDS || 86400);
    this.snapshotIntervalMs = Math.max(3600, Number.isFinite(snapshotSeconds) ? snapshotSeconds : 86400) * 1000;
    const forecastSeconds = Number(process.env.TELEMETRY_FORECAST_INTERVAL_SECONDS || 3600);
    this.forecastIntervalMs = Math.max(900, Number.isFinite(forecastSeconds) ? forecastSeconds : 3600) * 1000;
    this.status = {
      running: false,
      intervalMs: this.intervalMs,
      samplesCollected: 0,
      pendingUploads: 0,
      localArchivePath: this.store.archivePath,
      firebaseEnabled: this.firebase.enabled,
      firebaseProjectId: this.firebase.config?.projectId,
      firestoreDatabaseId: this.firebase.config?.databaseId,
      firebaseCredentialSource: this.firebase.config?.credentialSource
    };
    void this.loadEquipmentCatalog();
  }

  private async loadEquipmentCatalog() {
    try {
      this.equipmentCatalog = await new EquipmentCatalogStore().list();
    } catch (error) {
      console.warn('Equipment catalogue could not be loaded from the backend database; using bundled data.', error);
    }
  }

  start() { if (this.timer) return; this.status.running = true; void this.collectNow(); this.schedule(); }
  private schedule() { this.timer = setInterval(() => void this.collectNow(), this.intervalMs); this.timer.unref?.(); }
  setIntervalSeconds(intervalSeconds: number) {
    this.intervalMs = intervalSeconds * 1000; this.status.intervalMs = this.intervalMs;
    if (this.timer) { clearInterval(this.timer); this.schedule(); }
    return this.getStatus();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.status.running = false; }
  getStatus() { return { ...this.status, equipmentCatalog: this.equipmentCatalog }; }
  readRecentSamples(limit?: number) { return this.store.readRecent(limit); }
  readChartRange(since: number, maxPoints?: number) { return this.store.readChartRange(since, maxPoints); }

  collectNow() {
    const result = this.operation.then(() => this.collectAndFlush(), () => this.collectAndFlush());
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readWeather(): Promise<CurrentWeatherSnapshot | null> {
    if (!this.weather) return null;
    try {
      return await this.weather.current();
    } catch (error: any) {
      if (!String(error?.message || error).includes('location is not configured')) {
        console.warn(`Weather telemetry unavailable for this sample: ${error?.message || String(error)}`);
      }
      return null;
    }
  }

  private async readSensors(): Promise<SensorReading[]> {
    if (!this.sensorSource) return [];
    try {
      return await this.sensorSource.read();
    } catch (error: any) {
      console.warn(`Local sensor telemetry unavailable for this sample: ${error?.message || String(error)}`);
      return [];
    }
  }

  private async readForecastChanges(now: number): Promise<ForecastChange[]> {
    if (!this.weather || (this.lastForecastPollAt && now - this.lastForecastPollAt < this.forecastIntervalMs)) return [];
    try {
      const forecast = flattenForecast(await this.weather.forecast(2));
      this.lastForecastPollAt = now;
      const changed: ForecastChange[] = [];
      for (const item of forecast) {
        const key = forecastKey(item);
        const before = this.previousForecast.get(key);
        const meaningful = !before
          || (item.metric === 'windDirectionDegrees'
            ? directionChanged(before.value, item.value, forecastDeadband(item.metric))
            : numericChanged(before.value, item.value, forecastDeadband(item.metric)));
        if (meaningful) changed.push(item);
        this.previousForecast.set(key, item);
      }
      const activeKeys = new Set(forecast.map(forecastKey));
      for (const key of this.previousForecast.keys()) {
        if (!activeKeys.has(key)) this.previousForecast.delete(key);
      }
      return changed;
    } catch (error: any) {
      if (!String(error?.message || error).includes('location is not configured')) {
        console.warn(`Weather forecast telemetry unavailable: ${error?.message || String(error)}`);
      }
      return [];
    }
  }

  private async collectAndFlush() {
    try {
      const now = Date.now();
      const [spa, weather, sensors, forecast] = await Promise.all([
        this.spa.getStatus(), this.readWeather(), this.readSensors(), this.readForecastChanges(now)
      ]);
      const snapshot = this.lastSnapshotAt === 0 || now - this.lastSnapshotAt >= this.snapshotIntervalMs;
      const spaResult = spaChanges(this.previousSpa, spa);
      const weatherRows: WeatherObservation[] = weather?.raw || [];
      const weatherResult = snapshot
        ? { changed: weatherRows.map(row => ({ ...row })), fields: weatherRows.flatMap(row => WEATHER_NUMERIC_FIELDS.filter(field => row[field] !== undefined).map(field => `weather.${weatherKey(row)}.${String(field)}`)) }
        : weatherChanges(this.previousWeather, weatherRows);
      if (snapshot) {
        this.previousWeather.clear();
        for (const row of weatherRows) this.previousWeather.set(weatherKey(row), { ...row });
      }
      const sensorResult = snapshot
        ? { changed: sensors.map(row => ({ ...row })), fields: sensors.map(row => `sensor.${row.id}`) }
        : sensorChanges(this.previousSensors, sensors);
      if (snapshot) {
        this.previousSensors.clear();
        for (const row of sensors) this.previousSensors.set(row.id, { ...row });
      }

      const changedFields = snapshot
        ? [this.lastSnapshotAt === 0 ? 'initial' : 'snapshot', ...weatherResult.fields, ...sensorResult.fields, ...forecast.map(item => `forecast.${item.forecastFor}.${item.metric}`)]
        : [...spaResult.fields, ...weatherResult.fields, ...sensorResult.fields, ...forecast.map(item => `forecast.${item.forecastFor}.${item.metric}`)];

      this.previousSpa = spa;
      if (snapshot || changedFields.length > 0) {
        const record: TelemetryEventRecord = {
          schemaVersion: 2,
          id: crypto.randomUUID(),
          timestamp: now,
          hostId: this.hostId,
          collectorVersion: this.collectorVersion,
          recordKind: snapshot ? 'snapshot' : 'change',
          changedFields,
          spa: snapshot ? { ...spa } : spaResult.patch,
          sensors: sensorResult.changed.length ? sensorResult.changed : undefined,
          weather: weatherResult.changed.length ? weatherResult.changed : undefined,
          forecast: forecast.length ? forecast : undefined,
          weatherDerived: snapshot ? weather?.derived : undefined,
          weatherInfluence: snapshot ? weather?.influence : undefined,
          weatherSources: snapshot ? weather?.sources : undefined
        };
        await this.store.append(record);
        if (snapshot) this.lastSnapshotAt = now;
        this.status.samplesCollected += 1;
        this.status.lastSampleAt = now;
      }
      this.status.lastError = undefined;
    } catch (error: any) {
      this.status.lastError = `sample: ${error?.message || String(error)}`;
    }
    await this.flushPending();
  }

  async flushPending() {
    try {
      const pending = await this.store.readPending();
      this.status.pendingUploads = pending.length;
      if (!this.firebase.enabled || pending.length === 0) return;
      await this.firebase.writeSamples(pending);
      await this.store.acknowledgePending(pending.map(sample => sample.id));
      this.status.pendingUploads = await this.store.pendingCount();
      this.status.lastUploadAt = Date.now();
      this.status.lastError = undefined;
    } catch (error: any) {
      this.status.lastError = `upload: ${error?.message || String(error)}`;
      try { this.status.pendingUploads = await this.store.pendingCount(); } catch {}
    }
  }
}
