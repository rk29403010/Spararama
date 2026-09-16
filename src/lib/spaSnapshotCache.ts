import type { BestEffortTemperatureDto, SpaStatusDto } from './spaApi';

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SpaSnapshotCache {
  version: 1;
  savedAt: number;
  status?: SpaStatusDto;
  temperature?: BestEffortTemperatureDto;
}

export interface CachedWaterTemperature {
  valueC: number;
  observedAt: number;
}

const CACHE_PREFIX = 'spararama:spa-snapshot:';
const WATER_TEMPERATURE_SOURCES = new Set<BestEffortTemperatureDto['source']>([
  'live-spa',
  'recent-telemetry',
  'last-known-water'
]);

function browserStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function cacheKey(waterBodyId: string) {
  return `${CACHE_PREFIX}${waterBodyId}`;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readSnapshot(waterBodyId: string, storage: KeyValueStorage | null): SpaSnapshotCache | null {
  if (!waterBodyId || !storage) return null;
  try {
    const raw = storage.getItem(cacheKey(waterBodyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SpaSnapshotCache>;
    if (parsed.version !== 1 || !finiteNumber(parsed.savedAt)) return null;
    return parsed as SpaSnapshotCache;
  } catch {
    return null;
  }
}

function writeSnapshot(waterBodyId: string, snapshot: SpaSnapshotCache, storage: KeyValueStorage | null) {
  if (!waterBodyId || !storage) return;
  try {
    storage.setItem(cacheKey(waterBodyId), JSON.stringify(snapshot));
  } catch {
    // Last-known UI state is best effort. Live reads still work without browser storage.
  }
}

export function readCachedSpaStatus(waterBodyId: string, storage: KeyValueStorage | null = browserStorage()) {
  return readSnapshot(waterBodyId, storage)?.status ?? null;
}

export function cacheConnectedSpaStatus(
  waterBodyId: string,
  status: SpaStatusDto,
  storage: KeyValueStorage | null = browserStorage()
) {
  if (!status.connected) return;
  const previous = readSnapshot(waterBodyId, storage);
  writeSnapshot(waterBodyId, {
    ...(previous ?? {}),
    version: 1,
    savedAt: Date.now(),
    status
  }, storage);
}

export function cacheSpaTemperature(
  waterBodyId: string,
  temperature: BestEffortTemperatureDto,
  storage: KeyValueStorage | null = browserStorage()
) {
  if (!WATER_TEMPERATURE_SOURCES.has(temperature.source) || !finiteNumber(temperature.valueC)) return;
  const previous = readSnapshot(waterBodyId, storage);
  if (previous?.temperature && previous.temperature.observedAt > temperature.observedAt) return;
  writeSnapshot(waterBodyId, {
    ...(previous ?? {}),
    version: 1,
    savedAt: Date.now(),
    temperature
  }, storage);
}

export function readCachedWaterTemperature(
  waterBodyId: string,
  storage: KeyValueStorage | null = browserStorage()
): CachedWaterTemperature | null {
  const snapshot = readSnapshot(waterBodyId, storage);
  if (!snapshot) return null;

  const candidates: CachedWaterTemperature[] = [];
  const status = snapshot.status;
  if (status && finiteNumber(status.waterTemperatureC)) {
    const observedAt = status.waterTemperatureObservedAt ?? status.updatedAt;
    if (finiteNumber(observedAt) && observedAt > 0) {
      candidates.push({ valueC: status.waterTemperatureC, observedAt });
    }
  }

  const temperature = snapshot.temperature;
  if (temperature && WATER_TEMPERATURE_SOURCES.has(temperature.source) && finiteNumber(temperature.valueC) && finiteNumber(temperature.observedAt)) {
    candidates.push({ valueC: temperature.valueC, observedAt: temperature.observedAt });
  }

  candidates.sort((a, b) => b.observedAt - a.observedAt);
  return candidates[0] ?? null;
}
