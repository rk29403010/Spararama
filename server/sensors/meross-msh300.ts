import { createHash, randomBytes } from 'node:crypto';
import type { TelemetrySensorSource } from '../telemetry/collector';
import type { SensorReading } from '../telemetry/types';

const NS_SYSTEM_ALL = 'Appliance.System.All';
const NS_SENSOR_ALL = 'Appliance.Hub.Sensor.All';
const NS_BATTERY = 'Appliance.Hub.Battery';

interface MerossHeader {
  messageId?: string;
  namespace?: string;
  method?: string;
  timestamp?: number;
  sign?: string;
}

interface MerossResponse {
  header?: MerossHeader;
  payload?: Record<string, unknown>;
}

interface MerossSubdevice {
  id?: string;
  status?: number;
  lastActiveTime?: number;
  online?: { status?: number; lastActiveTime?: number };
  temperature?: { latest?: number; latestSampleTime?: number };
  humidity?: { latest?: number; latestSampleTime?: number };
  tempHum?: { latestTemperature?: number; latestHumidity?: number; syncedTime?: number; latestTime?: number; voltage?: number };
  tempHumi?: { temp?: number; humi?: number; latestTime?: number; voltage?: number };
  ms100?: { latestTemperature?: number; latestHumidity?: number; latestTime?: number; voltage?: number };
}

interface MerossBattery {
  id?: string;
  value?: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface MerossMsh300Config {
  endpoint: URL;
  key: string;
  timeoutMs: number;
  labels: Record<string, string>;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asSubdevices(value: unknown): MerossSubdevice[] {
  return Array.isArray(value) ? value.filter(item => asObject(item)) as MerossSubdevice[] : [];
}

function asBatteries(value: unknown): MerossBattery[] {
  return Array.isArray(value) ? value.filter(item => asObject(item)) as MerossBattery[] : [];
}

function messageSignature(messageId: string, key: string, timestamp: number) {
  return createHash('md5').update(`${messageId}${key}${timestamp}`, 'utf8').digest('hex');
}

function parseEndpoint(host: string) {
  const endpoint = new URL(host.includes('://') ? host : `http://${host}`);
  if (endpoint.protocol !== 'http:') throw new Error('MEROSS_MSH300_HOST must use the local HTTP protocol.');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('MEROSS_MSH300_HOST must contain only a host and optional port.');
  }
  if (endpoint.pathname !== '/' && endpoint.pathname !== '/config') {
    throw new Error('MEROSS_MSH300_HOST must not contain an arbitrary path.');
  }
  endpoint.pathname = '/config';
  return endpoint;
}

function parseLabels(raw: string | undefined) {
  if (!raw?.trim()) return {};
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error('MEROSS_MS100_LABELS_JSON must be a JSON object mapping subdevice IDs to labels.');
  }
  const object = asObject(decoded);
  if (!object || Object.values(object).some(value => typeof value !== 'string')) {
    throw new Error('MEROSS_MS100_LABELS_JSON must be a JSON object mapping subdevice IDs to labels.');
  }
  return object as Record<string, string>;
}

export function resolveMerossMsh300Config(env: NodeJS.ProcessEnv = process.env): MerossMsh300Config | undefined {
  const host = env.MEROSS_MSH300_HOST?.trim();
  if (!host) return undefined;
  const configuredTimeout = Number(env.MEROSS_MSH300_TIMEOUT_MS || 5000);
  return {
    endpoint: parseEndpoint(host),
    key: env.MEROSS_MSH300_KEY ?? '',
    timeoutMs: Number.isFinite(configuredTimeout) ? Math.min(30_000, Math.max(500, configuredTimeout)) : 5000,
    labels: parseLabels(env.MEROSS_MS100_LABELS_JSON)
  };
}

function readingTime(row: MerossSubdevice) {
  const seconds = [
    row.temperature?.latestSampleTime,
    row.humidity?.latestSampleTime,
    row.tempHum?.syncedTime,
    row.tempHum?.latestTime,
    row.tempHumi?.latestTime,
    row.ms100?.latestTime,
    row.online?.lastActiveTime,
    row.lastActiveTime
  ].filter(finite);
  return seconds.length ? Math.max(...seconds) * 1000 : undefined;
}

function latestTemperature(row: MerossSubdevice) {
  const raw = row.temperature?.latest
    ?? row.tempHum?.latestTemperature
    ?? row.tempHumi?.temp
    ?? row.ms100?.latestTemperature;
  return finite(raw) ? raw / 10 : undefined;
}

function latestHumidity(row: MerossSubdevice) {
  const raw = row.humidity?.latest
    ?? row.tempHum?.latestHumidity
    ?? row.tempHumi?.humi
    ?? row.ms100?.latestHumidity;
  return finite(raw) ? raw / 10 : undefined;
}

function latestVoltage(row: MerossSubdevice) {
  const voltage = row.tempHum?.voltage ?? row.tempHumi?.voltage ?? row.ms100?.voltage;
  return finite(voltage) ? voltage : undefined;
}

function metricId(subdeviceId: string, metric: string) {
  const safeId = subdeviceId.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
  return `meross-ms100.${safeId}.${metric}`;
}

export class MerossMsh300SensorSource implements TelemetrySensorSource {
  private discoveredIds: string[] = [];
  private digestById = new Map<string, MerossSubdevice>();
  private lastDiscoveryAt = 0;
  private replyHeader: MerossHeader | undefined;

  constructor(
    readonly config: MerossMsh300Config,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly warn: (message: string) => void = message => console.warn(message)
  ) {}

  private async request(namespace: string, payload: Record<string, unknown>) {
    const messageId = randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000);
    const standardHeader: MerossHeader = {
      messageId,
      namespace,
      method: 'GET',
      timestamp,
      sign: messageSignature(messageId, this.config.key, timestamp)
    };
    const requestHeader = !this.config.key && this.replyHeader
      ? { ...this.replyHeader, namespace, method: 'GET', payloadVersion: 1, triggerSrc: 'Spararama', from: 'Spararama' }
      : { ...standardHeader, payloadVersion: 1, triggerSrc: 'Spararama', from: 'Spararama', timestampMs: 0 };

    const send = async (header: Record<string, unknown>): Promise<MerossResponse> => {
      const response = await this.fetchImpl(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ header, payload }),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
      if (!response.ok) throw new Error(`MSH300 HTTP request failed (${response.status}).`);
      return await response.json() as MerossResponse;
    };

    let expectedMessageId = requestHeader.messageId as string;
    let body = await send(requestHeader);
    let errorCode = asObject(body.payload?.error)?.code;
    if (errorCode === 5001 && !this.config.key) {
      const challenge = body.header;
      if (!challenge?.messageId || !challenge.sign || !finite(challenge.timestamp)) {
        throw new Error('MSH300 requested reply-key authentication without a usable challenge.');
      }
      const challengeHeader = {
        ...challenge,
        namespace,
        method: 'GET',
        payloadVersion: 1,
        triggerSrc: 'Spararama',
        from: 'Spararama'
      };
      expectedMessageId = challenge.messageId;
      body = await send(challengeHeader);
      errorCode = asObject(body.payload?.error)?.code;
    }
    if (errorCode === 5001) {
      throw new Error('MSH300 rejected the configured device key. Check MEROSS_MSH300_KEY or leave it empty for LAN reply-key mode.');
    }
    if (errorCode !== undefined) throw new Error(`MSH300 returned Meross error ${String(errorCode)}.`);
    if (body.header?.namespace !== namespace || body.header?.method !== 'GETACK') {
      throw new Error(`MSH300 returned an unexpected response for ${namespace}.`);
    }
    if (body.header.messageId && body.header.messageId !== expectedMessageId) {
      throw new Error(`MSH300 returned a mismatched response for ${namespace}.`);
    }
    if (this.config.key && body.header.sign && finite(body.header.timestamp)) {
      const expected = messageSignature(body.header.messageId || expectedMessageId, this.config.key, body.header.timestamp);
      if (body.header.sign !== expected) throw new Error(`MSH300 returned an invalid signature for ${namespace}.`);
    }
    if (!this.config.key && body.header.messageId && body.header.sign && finite(body.header.timestamp)) {
      this.replyHeader = { ...body.header };
    }
    return body.payload || {};
  }

  private async discover(now = Date.now()) {
    if (this.discoveredIds.length && now - this.lastDiscoveryAt < 60 * 60 * 1000) return;
    const payload = await this.request(NS_SYSTEM_ALL, { all: {} });
    const all = asObject(payload.all);
    const digest = asObject(all?.digest);
    const hub = asObject(digest?.hub);
    const rows = asSubdevices(hub?.subdevice);
    this.digestById = new Map(rows.flatMap(row => row.id ? [[row.id, row]] : []));
    // Offline hub children often lose their type-specific digest until they wake.
    // Keep every remembered ID in the query so an offline MS100 is represented as
    // connectivity=false rather than silently disappearing from telemetry.
    this.discoveredIds = rows.flatMap(row => row.id ? [row.id] : []);
    this.lastDiscoveryAt = now;
  }

  private async readBattery(ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    try {
      const payload = await this.request(NS_BATTERY, { battery: ids.map(id => ({ id })) });
      return new Map(asBatteries(payload.battery).flatMap(row => row.id && finite(row.value) ? [[row.id, row.value]] : []));
    } catch (error: any) {
      this.warn(`Meross MS100 battery readings unavailable: ${error?.message || String(error)}`);
      return new Map<string, number>();
    }
  }

  async read(): Promise<SensorReading[]> {
    await this.discover();
    const requested = this.discoveredIds.map(id => ({ id }));
    const payload = await this.request(NS_SENSOR_ALL, { all: requested });
    const rows = asSubdevices(payload.all);
    if (!this.discoveredIds.length) {
      this.discoveredIds = rows.flatMap(row => row.id ? [row.id] : []);
    }
    const battery = await this.readBattery(this.discoveredIds);
    const readings: SensorReading[] = [];

    for (const row of rows) {
      if (!row.id) continue;
      const digest = this.digestById.get(row.id);
      const merged: MerossSubdevice = { ...digest, ...row };
      const observedAt = readingTime(merged);
      const location = this.config.labels[row.id] || `MS100 ${row.id.slice(-4)}`;
      const common = { location, deviceId: row.id, source: 'meross-msh300-lan', observedAt };
      const temperature = latestTemperature(merged);
      const humidity = latestHumidity(merged);
      const voltage = latestVoltage(merged);
      const batteryPercent = battery.get(row.id);
      const onlineStatus = row.online?.status ?? row.status ?? digest?.status;

      if (temperature !== undefined) readings.push({ id: metricId(row.id, 'temperature'), kind: 'temperature', value: temperature, unit: 'C', ...common });
      if (humidity !== undefined) readings.push({ id: metricId(row.id, 'humidity'), kind: 'humidity', value: humidity, unit: '%', ...common });
      if (batteryPercent !== undefined) readings.push({ id: metricId(row.id, 'battery'), kind: 'battery', value: batteryPercent, unit: '%', ...common });
      if (voltage !== undefined) readings.push({ id: metricId(row.id, 'battery-voltage'), kind: 'battery_voltage', value: voltage, unit: 'mV', ...common });
      if (finite(onlineStatus)) readings.push({ id: metricId(row.id, 'online'), kind: 'connectivity', value: onlineStatus === 1, ...common });
    }
    return readings;
  }
}

export function createMerossMsh300SensorSource(env: NodeJS.ProcessEnv = process.env) {
  const config = resolveMerossMsh300Config(env);
  return config ? new MerossMsh300SensorSource(config) : undefined;
}
