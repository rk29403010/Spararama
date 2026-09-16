import assert from 'node:assert/strict';
import test from 'node:test';
import type { BestEffortTemperatureDto, SpaStatusDto } from '../../src/lib/spaApi';
import {
  cacheConnectedSpaStatus,
  cacheSpaTemperature,
  readCachedSpaStatus,
  readCachedWaterTemperature
} from '../../src/lib/spaSnapshotCache';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function status(overrides: Partial<SpaStatusDto> = {}): SpaStatusDto {
  return {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 36,
    targetTemperatureC: 39,
    heaterOn: true,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 100,
    heaterRuntimeSeconds: 50,
    updatedAt: 1_000,
    lastContactAt: 1_000,
    ...overrides
  };
}

function temperature(overrides: Partial<BestEffortTemperatureDto> = {}): BestEffortTemperatureDto {
  return {
    valueC: 37,
    confidence: 'high',
    confidenceScore: 0.98,
    source: 'live-spa',
    observedAt: 2_000,
    estimated: false,
    ageMs: 0,
    reason: 'test',
    ...overrides
  };
}

test('connected spa status is available synchronously for the next page render', () => {
  const storage = new MemoryStorage();
  cacheConnectedSpaStatus('spa-1', status(), storage);
  assert.equal(readCachedSpaStatus('spa-1', storage)?.waterTemperatureC, 36);
  assert.equal(readCachedSpaStatus('spa-1', storage)?.heaterOn, true);
});

test('a disconnected response does not overwrite the last connected spa snapshot', () => {
  const storage = new MemoryStorage();
  cacheConnectedSpaStatus('spa-1', status({ waterTemperatureC: 36 }), storage);
  cacheConnectedSpaStatus('spa-1', status({ connected: false, waterTemperatureC: null, updatedAt: 3_000 }), storage);
  assert.equal(readCachedSpaStatus('spa-1', storage)?.waterTemperatureC, 36);
  assert.equal(readCachedSpaStatus('spa-1', storage)?.connected, true);
});

test('heating uses the newest cached water temperature from status or best-effort water data', () => {
  const storage = new MemoryStorage();
  cacheConnectedSpaStatus('spa-1', status({ waterTemperatureC: 35, updatedAt: 1_000 }), storage);
  cacheSpaTemperature('spa-1', temperature({ valueC: 37, observedAt: 2_000 }), storage);
  assert.deepEqual(readCachedWaterTemperature('spa-1', storage), { valueC: 37, observedAt: 2_000 });
});

test('ambient fallback temperatures are not persisted as last known spa water', () => {
  const storage = new MemoryStorage();
  cacheSpaTemperature('spa-1', temperature({ valueC: 15, source: 'ambient-default', observedAt: 2_000, estimated: true }), storage);
  assert.equal(readCachedWaterTemperature('spa-1', storage), null);
});
