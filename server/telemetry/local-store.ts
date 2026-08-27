import fs from 'node:fs/promises';
import path from 'node:path';
import type { SpaStatus } from '../spa/types';
import type {
  SensorReading,
  StoredTelemetryRecord,
  TelemetryEventRecord,
  TelemetrySample,
  WeatherObservation
} from './types';
import { rollUpTelemetry } from './rollup';

const SPA_EVENT_FIELDS: Array<keyof SpaStatus> = [
  'connected', 'waterTemperatureC', 'targetTemperatureC', 'heaterOn', 'filterOn', 'bubblesOn', 'transport', 'deviceFilterMinutes'
];
const WEATHER_FIELDS: Array<keyof WeatherObservation> = [
  'latitude', 'longitude', 'temperatureC', 'humidityPercent', 'pressureHpa', 'windSpeedMps', 'windDirectionDegrees',
  'cloudPercent', 'precipitationMm', 'shortwaveRadiationWm2'
];
const DAY_MS = 24 * 60 * 60 * 1000;

function isLegacy(record: StoredTelemetryRecord): record is TelemetrySample {
  return record.schemaVersion === 1;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numericChanged(previous: unknown, current: unknown, deadband = 0) {
  if (!finite(previous) || !finite(current)) return !Object.is(previous, current);
  return Math.abs(current - previous) >= deadband;
}

function directionChanged(previous: unknown, current: unknown, deadband = 5) {
  if (!finite(previous) || !finite(current)) return !Object.is(previous, current);
  return Math.abs((((current - previous) + 540) % 360) - 180) >= deadband;
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

function weatherKey(reading: WeatherObservation) {
  return reading.sourceLocationId || reading.station || reading.source;
}

function sensorHasChanged(previous: SensorReading | undefined, current: SensorReading) {
  if (!previous) return true;
  if (typeof previous.value === 'number' && typeof current.value === 'number') {
    return numericChanged(previous.value, current.value, sensorDeadband(current.kind));
  }
  return !Object.is(previous.value, current.value);
}

function legacyToEvents(samples: TelemetrySample[]): TelemetryEventRecord[] {
  const output: TelemetryEventRecord[] = [];
  let previous: TelemetrySample | null = null;
  let lastSnapshotAt = 0;

  for (const sample of samples) {
    const snapshot = !previous || !lastSnapshotAt || sample.timestamp - lastSnapshotAt >= DAY_MS;
    if (snapshot) {
      output.push({
        schemaVersion: 2,
        id: sample.id,
        timestamp: sample.timestamp,
        hostId: sample.hostId,
        collectorVersion: sample.collectorVersion,
        recordKind: 'snapshot',
        changedFields: [previous ? 'snapshot' : 'initial'],
        spa: { ...sample.spa },
        sensors: sample.sensors.map(item => ({ ...item })),
        weather: sample.weather.map(item => ({ ...item })),
        forecast: sample.forecast?.map(item => ({ ...item })),
        weatherDerived: sample.weatherDerived,
        weatherInfluence: sample.weatherInfluence,
        weatherSources: sample.weatherSources
      });
      lastSnapshotAt = sample.timestamp;
      previous = sample;
      continue;
    }

    const spaPatch: Partial<SpaStatus> = {};
    const changedFields: string[] = [];
    for (const field of SPA_EVENT_FIELDS) {
      const changed = field === 'waterTemperatureC'
        ? numericChanged(previous.spa[field], sample.spa[field], 0.1)
        : !Object.is(previous.spa[field], sample.spa[field]);
      if (!changed) continue;
      (spaPatch as any)[field] = sample.spa[field];
      changedFields.push(`spa.${String(field)}`);
    }

    const previousSensors = new Map(previous.sensors.map(item => [item.id, item]));
    const sensors = sample.sensors.filter(item => sensorHasChanged(previousSensors.get(item.id), item)).map(item => ({ ...item }));
    changedFields.push(...sensors.map(item => `sensor.${item.id}`));

    const previousWeather = new Map(previous.weather.map(item => [weatherKey(item), item]));
    const weather: WeatherObservation[] = [];
    for (const reading of sample.weather) {
      const key = weatherKey(reading);
      const before = previousWeather.get(key);
      if (!before) {
        weather.push({ ...reading });
        changedFields.push(...WEATHER_FIELDS.filter(field => reading[field] !== undefined).map(field => `weather.${key}.${String(field)}`));
        continue;
      }
      const patch: WeatherObservation = { source: reading.source, provider: reading.provider, sourceLocationId: reading.sourceLocationId, station: reading.station };
      let changed = false;
      for (const field of WEATHER_FIELDS) {
        const fieldChanged = field === 'windDirectionDegrees'
          ? directionChanged(before[field], reading[field], weatherDeadband(field))
          : numericChanged(before[field], reading[field], weatherDeadband(field));
        if (!fieldChanged) continue;
        (patch as any)[field] = reading[field];
        changedFields.push(`weather.${key}.${String(field)}`);
        changed = true;
      }
      if (changed) {
        patch.observedAt = reading.observedAt;
        weather.push(patch);
      }
    }

    if (changedFields.length) {
      output.push({
        schemaVersion: 2,
        id: sample.id,
        timestamp: sample.timestamp,
        hostId: sample.hostId,
        collectorVersion: sample.collectorVersion,
        recordKind: 'change',
        changedFields,
        spa: Object.keys(spaPatch).length ? spaPatch : undefined,
        sensors: sensors.length ? sensors : undefined,
        weather: weather.length ? weather : undefined
      });
    }
    previous = sample;
  }
  return output;
}

function materializeHost(records: StoredTelemetryRecord[]): TelemetrySample[] {
  const output: TelemetrySample[] = [];
  let spa: SpaStatus | null = null;
  const sensors = new Map<string, SensorReading>();
  const weather = new Map<string, WeatherObservation>();
  let weatherDerived: TelemetrySample['weatherDerived'];
  let weatherInfluence: TelemetrySample['weatherInfluence'];
  let weatherSources: TelemetrySample['weatherSources'];

  for (const record of records.slice().sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))) {
    if (isLegacy(record)) {
      spa = { ...record.spa };
      sensors.clear();
      for (const item of record.sensors) sensors.set(item.id, { ...item });
      weather.clear();
      for (const item of record.weather) weather.set(weatherKey(item), { ...item });
      weatherDerived = record.weatherDerived;
      weatherInfluence = record.weatherInfluence;
      weatherSources = record.weatherSources;
      output.push({ ...record, spa: { ...record.spa }, sensors: Array.from(sensors.values()), weather: Array.from(weather.values()) });
      continue;
    }

    if (record.recordKind === 'snapshot') {
      spa = record.spa ? { ...(record.spa as SpaStatus) } : null;
      sensors.clear();
      for (const item of record.sensors || []) sensors.set(item.id, { ...item });
      weather.clear();
      for (const item of record.weather || []) weather.set(weatherKey(item), { ...item });
    } else {
      if (record.spa) spa = spa ? { ...spa, ...record.spa } : { ...(record.spa as SpaStatus) };
      for (const item of record.sensors || []) sensors.set(item.id, { ...item });
      for (const item of record.weather || []) {
        const key = weatherKey(item);
        weather.set(key, { ...(weather.get(key) || {}), ...item } as WeatherObservation);
      }
    }
    if (record.weatherDerived !== undefined) weatherDerived = record.weatherDerived;
    if (record.weatherInfluence !== undefined) weatherInfluence = record.weatherInfluence;
    if (record.weatherSources !== undefined) weatherSources = record.weatherSources;
    if (!spa) continue;

    output.push({
      schemaVersion: 1,
      id: record.id,
      timestamp: record.timestamp,
      hostId: record.hostId,
      collectorVersion: record.collectorVersion,
      spa: { ...spa },
      changedFields: [...record.changedFields],
      sensors: Array.from(sensors.values()).map(item => ({ ...item })),
      weather: Array.from(weather.values()).map(item => ({ ...item })),
      forecast: record.forecast?.map(item => ({ ...item })),
      weatherDerived,
      weatherInfluence,
      weatherSources
    });
  }
  return output;
}

export function telemetryRecordKey(record: StoredTelemetryRecord) {
  return `${record.hostId}:${record.id}`;
}

/** Merge collector archives without feeding cloud records back into the upload queue. */
export function mergeTelemetryRecords(...groups: StoredTelemetryRecord[][]): StoredTelemetryRecord[] {
  const merged = new Map<string, StoredTelemetryRecord>();
  for (const group of groups) {
    for (const record of group) merged.set(telemetryRecordKey(record), record);
  }
  return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp || a.hostId.localeCompare(b.hostId) || a.id.localeCompare(b.id));
}

/** Materialize each collector independently, then combine their timelines. */
export function materializeTelemetryRecords(records: StoredTelemetryRecord[]): TelemetrySample[] {
  const byHost = new Map<string, StoredTelemetryRecord[]>();
  for (const record of records) {
    const group = byHost.get(record.hostId) || [];
    group.push(record);
    byHost.set(record.hostId, group);
  }
  return Array.from(byHost.values())
    .flatMap(materializeHost)
    .sort((a, b) => a.timestamp - b.timestamp || a.hostId.localeCompare(b.hostId) || a.id.localeCompare(b.id));
}

export class LocalTelemetryStore {
  readonly archivePath: string;
  readonly pendingPath: string;
  readonly remoteCachePath: string;
  private operation = Promise.resolve();

  constructor(baseDir = process.env.TELEMETRY_DIR || path.join(process.cwd(), 'data', 'telemetry')) {
    this.archivePath = path.join(baseDir, 'telemetry.ndjson');
    this.pendingPath = path.join(baseDir, 'pending.ndjson');
    this.remoteCachePath = path.join(baseDir, 'remote-cache.ndjson');
  }

  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operation.then(action, action);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async ensureDir() {
    await fs.mkdir(path.dirname(this.archivePath), { recursive: true });
  }

  private parse(text: string, label: 'queue' | 'archive' | 'remote cache'): StoredTelemetryRecord[] {
    const records: StoredTelemetryRecord[] = [];
    let lineNumber = 0;
    for (const line of text.split(/\r?\n/)) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        const noun = label === 'queue' ? 'queue entry' : `${label} entry`;
        throw new Error(`Malformed telemetry ${noun} at line ${lineNumber}; ${label} was left intact.`);
      }
    }
    return records;
  }

  private async readText(filePath: string) {
    await this.ensureDir();
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return '';
      throw error;
    }
  }

  async append(record: StoredTelemetryRecord) {
    return this.serialized(async () => {
      await this.ensureDir();
      const line = `${JSON.stringify(record)}\n`;
      await fs.appendFile(this.archivePath, line, 'utf8');
      await fs.appendFile(this.pendingPath, line, 'utf8');
    });
  }

  async readArchiveRecords(): Promise<StoredTelemetryRecord[]> {
    return this.serialized(async () => this.parse(await this.readText(this.archivePath), 'archive'));
  }

  async readPending(): Promise<StoredTelemetryRecord[]> {
    return this.serialized(async () => this.parse(await this.readText(this.pendingPath), 'queue'));
  }

  async readRemoteCache(): Promise<StoredTelemetryRecord[]> {
    return this.serialized(async () => this.parse(await this.readText(this.remoteCachePath), 'remote cache'));
  }

  async replaceRemoteCache(records: StoredTelemetryRecord[]) {
    return this.serialized(async () => {
      await this.ensureDir();
      const merged = mergeTelemetryRecords(records);
      const data = merged.length ? `${merged.map(record => JSON.stringify(record)).join('\n')}\n` : '';
      const tempPath = `${this.remoteCachePath}.tmp-${process.pid}`;
      await fs.writeFile(tempPath, data, 'utf8');
      await fs.rename(tempPath, this.remoteCachePath);
    });
  }

  async replacePending(records: StoredTelemetryRecord[]) {
    return this.serialized(async () => {
      await this.ensureDir();
      const data = records.length ? `${records.map(record => JSON.stringify(record)).join('\n')}\n` : '';
      await fs.writeFile(this.pendingPath, data, 'utf8');
    });
  }

  async acknowledgePending(uploadedIds: string[]) {
    const acknowledged = new Set(uploadedIds);
    return this.serialized(async () => {
      const records = this.parse(await this.readText(this.pendingPath), 'queue');
      const remaining = records.filter(record => !acknowledged.has(record.id));
      const data = remaining.length ? `${remaining.map(record => JSON.stringify(record)).join('\n')}\n` : '';
      await fs.writeFile(this.pendingPath, data, 'utf8');
    });
  }

  async pendingCount() {
    return (await this.readPending()).length;
  }

  private async compactFile(filePath: string, label: 'queue' | 'archive') {
    const text = await this.readText(filePath);
    if (!text.trim()) return { before: 0, after: 0, migrated: false };
    const records = this.parse(text, label);
    if (!records.length || !records.every(isLegacy)) return { before: records.length, after: records.length, migrated: false };

    const compacted = legacyToEvents(records);
    const backupPath = `${filePath}.v1-backup`;
    try {
      await fs.access(backupPath);
    } catch {
      await fs.writeFile(backupPath, text, 'utf8');
    }
    const data = compacted.length ? `${compacted.map(record => JSON.stringify(record)).join('\n')}\n` : '';
    const tempPath = `${filePath}.tmp-${process.pid}`;
    await fs.writeFile(tempPath, data, 'utf8');
    await fs.rename(tempPath, filePath);
    return { before: records.length, after: compacted.length, migrated: true, backupPath };
  }

  /** One-time safe conversion of an all-v1 archive/queue to sparse v2 events. */
  async compactLegacyTelemetry() {
    return this.serialized(async () => {
      await this.ensureDir();
      const archive = await this.compactFile(this.archivePath, 'archive');
      const pending = await this.compactFile(this.pendingPath, 'queue');
      return { archive, pending };
    });
  }

  async readRecent(limit = 200) {
    const samples = materializeTelemetryRecords(await this.readArchiveRecords());
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 200));
    return { samples: samples.slice(-safeLimit).reverse(), total: samples.length };
  }

  async readChartRange(since: number, maxPoints = 500) {
    // Materialize before filtering so a change just inside the requested window
    // inherits state from the most recent snapshot/event before that window.
    const samples = materializeTelemetryRecords(await this.readArchiveRecords())
      .filter(sample => Number.isFinite(sample.timestamp) && sample.timestamp >= since)
      .sort((a, b) => a.timestamp - b.timestamp);
    const safeMax = Math.max(50, Math.min(800, Math.floor(maxPoints) || 500));
    const rolled = rollUpTelemetry(samples, safeMax);
    return { samples: rolled, rawTotal: samples.length, rolledUp: rolled.length < samples.length };
  }
}
