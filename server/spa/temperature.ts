import type { SpaAdapter, SpaStatus } from './types';
import type { LocalTelemetryStore } from '../telemetry/local-store';
import type { TelemetrySample } from '../telemetry/types';

export type TemperatureConfidence = 'high' | 'medium' | 'low';
export type TemperatureSource =
  | 'live-spa'
  | 'recent-telemetry'
  | 'last-known-water'
  | 'ambient-sensor'
  | 'weather'
  | 'ambient-default';

export interface BestEffortTemperature {
  valueC: number;
  confidence: TemperatureConfidence;
  confidenceScore: number;
  source: TemperatureSource;
  observedAt: number;
  estimated: boolean;
  ageMs: number;
  reason: string;
}

interface ResolveOptions {
  liveStatus?: SpaStatus;
  allowAdapterRefresh?: boolean;
  now?: number;
}

const FRESH_MS = 5 * 60 * 1000;
const RECENT_MS = 30 * 60 * 1000;
const USEFUL_LAST_KNOWN_MS = 24 * 60 * 60 * 1000;
const AMBIENT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function finiteTemperature(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > -20 && value < 60;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, value));
}

function confidenceFor(score: number): TemperatureConfidence {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

function result(valueC: number, score: number, source: TemperatureSource, observedAt: number, now: number, estimated: boolean, reason: string): BestEffortTemperature {
  const confidenceScore = clampScore(score);
  return {
    valueC,
    confidence: confidenceFor(confidenceScore),
    confidenceScore,
    source,
    observedAt,
    estimated,
    ageMs: Math.max(0, now - observedAt),
    reason
  };
}

function statusCandidate(status: SpaStatus | undefined, now: number) {
  if (!status || !finiteTemperature(status.waterTemperatureC)) return null;
  const observedAt = Number.isFinite(status.updatedAt) && status.updatedAt > 0 ? status.updatedAt : now;
  return { valueC: status.waterTemperatureC, observedAt, connected: status.connected, transport: status.transport };
}

function latestWaterSample(samples: TelemetrySample[]) {
  for (const sample of samples) {
    if (finiteTemperature(sample.spa?.waterTemperatureC)) {
      const observedAt = Number.isFinite(sample.spa.updatedAt) && sample.spa.updatedAt > 0 ? sample.spa.updatedAt : sample.timestamp;
      return { valueC: sample.spa.waterTemperatureC, observedAt, connected: sample.spa.connected };
    }
  }
  return null;
}

function latestAmbient(samples: TelemetrySample[], now: number) {
  for (const sample of samples) {
    const ageMs = Math.max(0, now - sample.timestamp);
    if (ageMs > AMBIENT_MAX_AGE_MS) continue;

    for (const sensor of sample.sensors || []) {
      if (typeof sensor.value !== 'number' || !finiteTemperature(sensor.value)) continue;
      const name = `${sensor.kind} ${sensor.location || ''}`.toLowerCase();
      if (/(ambient|outside|outdoor|air)/.test(name) && /(temp|temperature)/.test(name)) {
        const quality = typeof sensor.quality === 'number' ? clampScore(sensor.quality) : 0.65;
        return { valueC: sensor.value, observedAt: sample.timestamp, score: Math.max(0.25, quality * 0.65), source: 'ambient-sensor' as const };
      }
    }

    for (const weather of sample.weather || []) {
      if (!finiteTemperature(weather.temperatureC)) continue;
      const observedAt = Number.isFinite(weather.observedAt) ? Number(weather.observedAt) : sample.timestamp;
      if (Math.max(0, now - observedAt) <= AMBIENT_MAX_AGE_MS) {
        return { valueC: weather.temperatureC, observedAt, score: 0.4, source: 'weather' as const };
      }
    }
  }
  return null;
}

export class BestEffortTemperatureResolver {
  constructor(private readonly spa: SpaAdapter, private readonly store: LocalTelemetryStore) {}

  async resolve(options: ResolveOptions = {}): Promise<BestEffortTemperature> {
    const now = options.now ?? Date.now();
    let samples: TelemetrySample[] = [];
    try {
      samples = (await this.store.readRecent(300)).samples;
    } catch {
      // Temperature lookup should still work if the local archive is unavailable.
    }

    const supplied = statusCandidate(options.liveStatus, now);
    if (supplied?.connected && now - supplied.observedAt <= FRESH_MS) {
      return result(supplied.valueC, 0.98, 'live-spa', supplied.observedAt, now, false, 'Fresh temperature returned by the connected spa.');
    }

    const stored = latestWaterSample(samples);
    if (!options.liveStatus && stored && now - stored.observedAt <= FRESH_MS) {
      const score = stored.connected ? 0.9 : 0.82;
      return result(stored.valueC, score, 'recent-telemetry', stored.observedAt, now, false, 'A fairly fresh locally recorded spa temperature is available, so no extra hardware read was needed.');
    }

    let refreshed: ReturnType<typeof statusCandidate> = null;
    if (options.allowAdapterRefresh !== false) {
      try {
        const status = await this.spa.getStatus();
        refreshed = statusCandidate(status, now);
        if (refreshed?.connected && now - refreshed.observedAt <= FRESH_MS) {
          return result(refreshed.valueC, 0.98, 'live-spa', refreshed.observedAt, now, false, 'No fairly fresh cached value existed, so the connected spa was read directly.');
        }
      } catch {
        // Fall through to the best locally available estimate.
      }
    }

    const candidates = [supplied, refreshed, stored].filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    candidates.sort((a, b) => b.observedAt - a.observedAt);
    const lastKnown = candidates[0];
    if (lastKnown) {
      const ageMs = Math.max(0, now - lastKnown.observedAt);
      if (ageMs <= RECENT_MS) {
        const score = 0.76 - (ageMs / RECENT_MS) * 0.16;
        return result(lastKnown.valueC, score, 'last-known-water', lastKnown.observedAt, now, true, 'Live contact was unavailable, so the latest recent water reading is being used as the current estimate.');
      }
      if (ageMs <= USEFUL_LAST_KNOWN_MS) {
        const score = 0.48 - (ageMs / USEFUL_LAST_KNOWN_MS) * 0.23;
        return result(lastKnown.valueC, score, 'last-known-water', lastKnown.observedAt, now, true, 'The last water reading is old but still more useful than an unrelated ambient fallback.');
      }
    }

    const ambient = latestAmbient(samples, now);
    if (ambient) {
      return result(ambient.valueC, ambient.score, ambient.source, ambient.observedAt, now, true, 'No useful water reading exists; ambient conditions are being used as a low-confidence starting estimate.');
    }

    const configuredAmbient = Number(process.env.SPARARAMA_AMBIENT_DEFAULT_C);
    const ambientDefault = finiteTemperature(configuredAmbient) ? configuredAmbient : 15;
    return result(ambientDefault, 0.1, 'ambient-default', now, now, true, 'No useful spa, sensor or weather temperature exists; using the configured ambient fallback (15°C when unset).');
  }
}
