import type { TelemetrySensorSource } from '../telemetry/collector';
import type { SensorReading } from '../telemetry/types';
import type {
  CurrentWeatherSource,
  RawWeatherReading,
  WeatherSettings,
  WeatherSourceLocation
} from '../weather/types';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Row = Record<string, unknown>;

export interface EcowittConfig {
  endpoint: URL;
  timeoutMs: number;
  cacheMs: number;
  locationLabel: string;
}

export interface EcowittStatus {
  configured: true;
  host: string;
  lastSuccessAt?: number;
  lastError?: string;
}

function asObject(value: unknown): Row | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.flatMap(item => asObject(item) ? [item as Row] : []) : [];
}

function parseEndpoint(host: string) {
  const endpoint = new URL(host.includes('://') ? host : `http://${host}`);
  if (endpoint.protocol !== 'http:') throw new Error('ECOWITT_HOST must use the local HTTP protocol.');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('ECOWITT_HOST must contain only a host and optional port.');
  }
  if (endpoint.pathname !== '/' && endpoint.pathname !== '') {
    throw new Error('ECOWITT_HOST must not contain an arbitrary path.');
  }
  endpoint.pathname = '/get_livedata_info';
  return endpoint;
}

export function resolveEcowittConfig(env: NodeJS.ProcessEnv = process.env): EcowittConfig | undefined {
  const host = env.ECOWITT_HOST?.trim();
  if (!host) return undefined;
  const timeout = Number(env.ECOWITT_TIMEOUT_MS || 5000);
  const cache = Number(env.ECOWITT_CACHE_MS || 5000);
  return {
    endpoint: parseEndpoint(host),
    timeoutMs: Number.isFinite(timeout) ? Math.min(30_000, Math.max(500, timeout)) : 5000,
    cacheMs: Number.isFinite(cache) ? Math.min(60_000, Math.max(0, cache)) : 5000,
    locationLabel: env.ECOWITT_LOCATION_LABEL?.trim() || 'Garden weather station'
  };
}

function numeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || /^(none|null|nan|--)?$/i.test(value.trim())) return undefined;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function units(row: Row) {
  return `${String(row.unit || '')} ${String(row.val || '')}`.toLowerCase();
}

function temperatureC(row: Row) {
  const value = numeric(row.temp ?? row.val);
  if (value === undefined) return undefined;
  const unit = `${String(row.unit || '')} ${String(row.temp ?? row.val ?? '')}`.toLowerCase();
  return /°?f\b|fahrenheit/.test(unit) ? (value - 32) * 5 / 9 : value;
}

function humidityPercent(value: unknown) {
  return numeric(value);
}

function speedMps(row: Row) {
  const value = numeric(row.val);
  if (value === undefined) return undefined;
  const unit = units(row);
  if (unit.includes('mph')) return value * 0.44704;
  if (unit.includes('km/h') || unit.includes('kph')) return value / 3.6;
  if (/\bkn(?:ot|ots)?\b/.test(unit)) return value * 0.514444;
  return value;
}

function pressureHpaValue(value: unknown) {
  const number = numeric(value);
  if (number === undefined) return undefined;
  const unit = String(value || '').toLowerCase();
  if (unit.includes('inhg')) return number * 33.8638866667;
  if (unit.includes('mmhg')) return number * 1.3332239;
  return number;
}

function pressureHpa(row: Row) {
  const value = row.val ?? row.rel ?? row.abs;
  const number = numeric(value);
  if (number === undefined) return undefined;
  const unit = `${units(row)} ${String(value || '')}`;
  if (unit.includes('inhg')) return number * 33.8638866667;
  if (unit.includes('mmhg')) return number * 1.3332239;
  return number;
}

function rainMm(row: Row) {
  const value = numeric(row.val);
  if (value === undefined) return undefined;
  return /\bin\b|inch/.test(units(row)) ? value * 25.4 : value;
}

function solarWm2(row: Row) {
  const value = numeric(row.val);
  if (value === undefined) return undefined;
  const unit = units(row);
  if (unit.includes('lux')) return undefined;
  return value;
}

function normaliseCommonId(value: unknown) {
  const id = String(value || '').trim();
  if (!/^0x[0-9a-f]+$/i.test(id)) return id;
  return `0x${Number.parseInt(id.slice(2), 16).toString(16).toUpperCase().padStart(2, '0')}`;
}

function commonRows(payload: Row) {
  return asRows(payload.common_list);
}

function commonRow(payload: Row, id: string) {
  const expected = normaliseCommonId(id);
  return commonRows(payload).find(row => normaliseCommonId(row.id) === expected);
}

function safeSegment(value: unknown, fallback: string) {
  const text = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return text || fallback;
}

function addReading(target: Map<string, SensorReading>, reading: SensorReading | undefined) {
  if (reading) target.set(reading.id, reading);
}

interface CommonMetricDef {
  id: string;
  suffix: string;
  kind: string;
  unit?: string;
  convert: (row: Row) => number | undefined;
  indoor?: boolean;
}

const COMMON_METRICS: CommonMetricDef[] = [
  { id: '0x01', suffix: 'indoor-temperature', kind: 'indoor_temperature', unit: 'C', convert: temperatureC, indoor: true },
  { id: '0x02', suffix: 'outdoor-temperature', kind: 'temperature', unit: 'C', convert: temperatureC },
  { id: '0x03', suffix: 'dew-point', kind: 'dew_point', unit: 'C', convert: temperatureC },
  { id: '0x04', suffix: 'wind-chill', kind: 'wind_chill', unit: 'C', convert: temperatureC },
  { id: '0x05', suffix: 'heat-index', kind: 'heat_index', unit: 'C', convert: temperatureC },
  { id: '0x06', suffix: 'indoor-humidity', kind: 'indoor_humidity', unit: '%', convert: row => humidityPercent(row.val), indoor: true },
  { id: '0x07', suffix: 'outdoor-humidity', kind: 'humidity', unit: '%', convert: row => humidityPercent(row.val) },
  { id: '0x08', suffix: 'absolute-pressure', kind: 'pressure_absolute', unit: 'hPa', convert: pressureHpa },
  { id: '0x09', suffix: 'relative-pressure', kind: 'pressure', unit: 'hPa', convert: pressureHpa },
  { id: '0x0A', suffix: 'wind-direction', kind: 'wind_direction', unit: 'deg', convert: row => numeric(row.val) },
  { id: '0x0B', suffix: 'wind-speed', kind: 'wind_speed', unit: 'm/s', convert: speedMps },
  { id: '0x0C', suffix: 'wind-gust', kind: 'wind_gust', unit: 'm/s', convert: speedMps },
  { id: '0x17', suffix: 'uv-index', kind: 'uv_index', convert: row => numeric(row.val) },
  { id: '0x19', suffix: 'day-wind-max', kind: 'wind_max_day', unit: 'm/s', convert: speedMps }
];

function appendCommonReadings(target: Map<string, SensorReading>, payload: Row, config: EcowittConfig, observedAt: number) {
  for (const definition of COMMON_METRICS) {
    const row = commonRow(payload, definition.id);
    if (!row) continue;
    const value = definition.convert(row);
    if (value === undefined) continue;
    addReading(target, {
      id: `ecowitt.weather.${definition.suffix}`,
      kind: definition.kind,
      value,
      unit: definition.unit,
      location: definition.indoor ? `${config.locationLabel} gateway` : config.locationLabel,
      deviceId: 'ecowitt-main',
      source: 'ecowitt-lan',
      observedAt
    });
  }

  const light = commonRow(payload, '0x15');
  if (light) {
    const value = numeric(light.val);
    if (value !== undefined) {
      const isLux = units(light).includes('lux');
      addReading(target, {
        id: `ecowitt.weather.${isLux ? 'light' : 'solar-radiation'}`,
        kind: isLux ? 'light' : 'solar_radiation',
        value,
        unit: isLux ? 'lux' : 'W/m2',
        location: config.locationLabel,
        deviceId: 'ecowitt-main',
        source: 'ecowitt-lan',
        observedAt
      });
    }
  }
}

function appendRainReadings(target: Map<string, SensorReading>, payload: Row, config: EcowittConfig, observedAt: number) {
  const definitions: Record<string, { suffix: string; kind: string; unit: string }> = {
    '0x0D': { suffix: 'rain-event', kind: 'rain_event', unit: 'mm' },
    '0x0E': { suffix: 'rain-rate', kind: 'rain_rate', unit: 'mm/h' },
    '0x10': { suffix: 'rain-day', kind: 'rain_day', unit: 'mm' },
    '0x11': { suffix: 'rain-week', kind: 'rain_week', unit: 'mm' },
    '0x12': { suffix: 'rain-month', kind: 'rain_month', unit: 'mm' },
    '0x13': { suffix: 'rain-year', kind: 'rain_year', unit: 'mm' }
  };
  const rows = [...asRows(payload.rain), ...asRows(payload.piezoRain)];
  for (const row of rows) {
    const definition = definitions[normaliseCommonId(row.id)];
    if (!definition) continue;
    const value = rainMm(row);
    if (value === undefined) continue;
    addReading(target, {
      id: `ecowitt.weather.${definition.suffix}`,
      kind: definition.kind,
      value,
      unit: definition.unit,
      location: config.locationLabel,
      deviceId: 'ecowitt-main',
      source: 'ecowitt-lan',
      observedAt
    });
  }
}

function appendTempHumidityChannels(target: Map<string, SensorReading>, payload: Row, group: 'ch_aisle' | 'ch_temp', config: EcowittConfig, observedAt: number) {
  for (const row of asRows(payload[group])) {
    const channel = safeSegment(row.channel, 'unknown');
    const location = String(row.name || '').trim() || `${config.locationLabel} channel ${channel}`;
    const deviceId = `ecowitt-${group}-${channel}`;
    const temperature = temperatureC(row);
    if (temperature !== undefined) addReading(target, {
      id: `ecowitt.channel.${group.slice(3)}.${channel}.temperature`, kind: 'temperature', value: temperature, unit: 'C', location, deviceId, source: 'ecowitt-lan', observedAt
    });
    const humidity = humidityPercent(row.humidity);
    if (humidity !== undefined) addReading(target, {
      id: `ecowitt.channel.${group.slice(3)}.${channel}.humidity`, kind: 'humidity', value: humidity, unit: '%', location, deviceId, source: 'ecowitt-lan', observedAt
    });
  }
}

function appendSimpleChannels(target: Map<string, SensorReading>, payload: Row, config: EcowittConfig, observedAt: number) {
  for (const row of asRows(payload.ch_soil)) {
    const channel = safeSegment(row.channel, 'unknown');
    const value = humidityPercent(row.humidity);
    if (value === undefined) continue;
    const location = String(row.name || '').trim() || `${config.locationLabel} soil ${channel}`;
    addReading(target, { id: `ecowitt.channel.soil.${channel}.moisture`, kind: 'soil_moisture', value, unit: '%', location, deviceId: `ecowitt-ch-soil-${channel}`, source: 'ecowitt-lan', observedAt });
  }
  for (const row of asRows(payload.ch_leaf)) {
    const channel = safeSegment(row.channel, 'unknown');
    const value = humidityPercent(row.humidity);
    if (value === undefined) continue;
    const location = String(row.name || '').trim() || `${config.locationLabel} leaf ${channel}`;
    addReading(target, { id: `ecowitt.channel.leaf.${channel}.wetness`, kind: 'leaf_wetness', value, unit: '%', location, deviceId: `ecowitt-ch-leaf-${channel}`, source: 'ecowitt-lan', observedAt });
  }
  for (const row of asRows(payload.ch_leak)) {
    const channel = safeSegment(row.channel, 'unknown');
    const status = String(row.status || '').trim();
    if (!status) continue;
    const location = String(row.name || '').trim() || `${config.locationLabel} leak ${channel}`;
    addReading(target, { id: `ecowitt.channel.leak.${channel}.status`, kind: 'leak_status', value: status, location, deviceId: `ecowitt-ch-leak-${channel}`, source: 'ecowitt-lan', observedAt });
  }
  for (const row of asRows(payload.ch_pm25)) {
    const channel = safeSegment(row.channel, 'unknown');
    const value = numeric(row.PM25);
    if (value === undefined) continue;
    const location = String(row.name || '').trim() || `${config.locationLabel} air ${channel}`;
    addReading(target, { id: `ecowitt.channel.pm25.${channel}.pm25`, kind: 'pm25', value, unit: 'ug/m3', location, deviceId: `ecowitt-ch-pm25-${channel}`, source: 'ecowitt-lan', observedAt });
  }
}

function appendLightning(target: Map<string, SensorReading>, payload: Row, config: EcowittConfig, observedAt: number) {
  const row = asRows(payload.lightning)[0];
  if (!row) return;
  const distance = numeric(row.distance);
  if (distance !== undefined) addReading(target, { id: 'ecowitt.lightning.distance', kind: 'lightning_distance', value: distance, unit: String(row.distance || '').toLowerCase().includes('mi') ? 'mi' : 'km', location: config.locationLabel, deviceId: 'ecowitt-lightning', source: 'ecowitt-lan', observedAt });
  const count = numeric(row.count);
  if (count !== undefined) addReading(target, { id: 'ecowitt.lightning.count', kind: 'lightning_count', value: count, location: config.locationLabel, deviceId: 'ecowitt-lightning', source: 'ecowitt-lan', observedAt });
}

function appendUnknownChannels(target: Map<string, SensorReading>, payload: Row, config: EcowittConfig, observedAt: number) {
  const handled = new Set(['ch_aisle', 'ch_temp', 'ch_soil', 'ch_leaf', 'ch_leak', 'ch_pm25']);
  for (const [group, value] of Object.entries(payload)) {
    if (!group.startsWith('ch_') || handled.has(group) || !Array.isArray(value)) continue;
    for (const row of asRows(value)) {
      const channel = safeSegment(row.channel ?? row.id, 'unknown');
      const location = String(row.name || '').trim() || `${config.locationLabel} ${group.slice(3)} ${channel}`;
      for (const [field, raw] of Object.entries(row)) {
        if (['channel', 'id', 'name', 'unit'].includes(field) || raw === undefined || raw === null || String(raw).trim().toLowerCase() === 'none') continue;
        if (!['string', 'number', 'boolean'].includes(typeof raw)) continue;
        const parsed = typeof raw === 'string' ? numeric(raw) : undefined;
        const readingValue = typeof raw === 'string' && parsed !== undefined ? parsed : raw as string | number | boolean;
        addReading(target, {
          id: `ecowitt.channel.${safeSegment(group.slice(3), 'sensor')}.${channel}.${safeSegment(field, 'value')}`,
          kind: `${safeSegment(group.slice(3), 'sensor')}_${safeSegment(field, 'value')}`,
          value: readingValue,
          unit: typeof row.unit === 'string' ? row.unit : undefined,
          location,
          deviceId: `ecowitt-${safeSegment(group, 'channel')}-${channel}`,
          source: 'ecowitt-lan',
          observedAt
        });
      }
    }
  }
}

function wh25Pressure(payload: Row) {
  const row = asRows(payload.wh25)[0];
  if (!row) return undefined;
  return pressureHpaValue(row.rel ?? row.abs);
}

export class EcowittLanClient {
  private cache?: { fetchedAt: number; payload: Row };
  private inFlight?: Promise<Row>;
  private lastSuccessAt?: number;
  private lastError?: string;

  constructor(readonly config: EcowittConfig, private readonly fetchImpl: FetchLike = fetch) {}

  getStatus(): EcowittStatus {
    return { configured: true, host: this.config.endpoint.host, lastSuccessAt: this.lastSuccessAt, lastError: this.lastError };
  }

  async readLiveData(): Promise<Row> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt <= this.config.cacheMs) return this.cache.payload;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchLiveData();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async fetchLiveData(): Promise<Row> {
    try {
      const response = await this.fetchImpl(this.config.endpoint, { method: 'GET', signal: AbortSignal.timeout(this.config.timeoutMs) });
      if (!response.ok) throw new Error(`Ecowitt live-data request failed (${response.status}).`);
      const payload = asObject(await response.json());
      if (!payload) throw new Error('Ecowitt returned an invalid live-data payload.');
      const fetchedAt = Date.now();
      this.cache = { fetchedAt, payload };
      this.lastSuccessAt = fetchedAt;
      this.lastError = undefined;
      return payload;
    } catch (error: any) {
      this.lastError = error?.message || String(error);
      throw error;
    }
  }
}

export class EcowittSensorSource implements TelemetrySensorSource {
  constructor(readonly client: EcowittLanClient) {}

  async read(): Promise<SensorReading[]> {
    const payload = await this.client.readLiveData();
    const observedAt = this.client.getStatus().lastSuccessAt || Date.now();
    const readings = new Map<string, SensorReading>();
    appendCommonReadings(readings, payload, this.client.config, observedAt);
    appendRainReadings(readings, payload, this.client.config, observedAt);
    appendTempHumidityChannels(readings, payload, 'ch_aisle', this.client.config, observedAt);
    appendTempHumidityChannels(readings, payload, 'ch_temp', this.client.config, observedAt);
    appendSimpleChannels(readings, payload, this.client.config, observedAt);
    appendLightning(readings, payload, this.client.config, observedAt);
    appendUnknownChannels(readings, payload, this.client.config, observedAt);
    return [...readings.values()];
  }
}

export class EcowittCurrentWeatherSource implements CurrentWeatherSource {
  constructor(readonly client: EcowittLanClient) {}

  async readCurrent(settings: WeatherSettings) {
    const payload = await this.client.readLiveData();
    const status = this.client.getStatus();
    const sourceLocationId = 'ecowitt-local';
    const source: WeatherSourceLocation = {
      id: sourceLocationId,
      provider: 'ecowitt',
      requestedLatitude: settings.location?.latitude,
      requestedLongitude: settings.location?.longitude,
      label: this.client.config.locationLabel
    };
    const reading: RawWeatherReading = {
      source: 'ecowitt-lan',
      provider: 'ecowitt',
      sourceLocationId,
      station: this.client.config.locationLabel,
      latitude: settings.location?.latitude,
      longitude: settings.location?.longitude,
      temperatureC: commonRow(payload, '0x02') ? temperatureC(commonRow(payload, '0x02')!) : undefined,
      humidityPercent: commonRow(payload, '0x07') ? humidityPercent(commonRow(payload, '0x07')!.val) : undefined,
      pressureHpa: commonRow(payload, '0x09') ? pressureHpa(commonRow(payload, '0x09')!) : (commonRow(payload, '0x08') ? pressureHpa(commonRow(payload, '0x08')!) : wh25Pressure(payload)),
      windSpeedMps: commonRow(payload, '0x0B') ? speedMps(commonRow(payload, '0x0B')!) : undefined,
      windDirectionDegrees: commonRow(payload, '0x0A') ? numeric(commonRow(payload, '0x0A')!.val) : undefined,
      shortwaveRadiationWm2: commonRow(payload, '0x15') ? solarWm2(commonRow(payload, '0x15')!) : undefined,
      observedAt: status.lastSuccessAt || Date.now()
    };
    const hasWeather = [reading.temperatureC, reading.humidityPercent, reading.pressureHpa, reading.windSpeedMps, reading.windDirectionDegrees, reading.shortwaveRadiationWm2]
      .some(value => typeof value === 'number' && Number.isFinite(value));
    return hasWeather ? { source, reading } : null;
  }
}

export function createEcowittLanIntegration(env: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch) {
  const config = resolveEcowittConfig(env);
  if (!config) return undefined;
  const client = new EcowittLanClient(config, fetchImpl);
  return {
    client,
    sensorSource: new EcowittSensorSource(client),
    weatherSource: new EcowittCurrentWeatherSource(client)
  };
}
