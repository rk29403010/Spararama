import { get, set } from 'idb-keyval';
import { AppState, DEFAULT_SPA_CONFIG } from '../types';
import { createDefaultDomainState } from '../domain/defaults';
import { correctLegacySevenWayReadings } from '../domain/stripScales';

const STORE_KEY = 'hottub_state';

function makeDefaultState(): AppState {
  return {
    inventory: [],
    readings: [],
    heatingSessions: [],
    reminders: [],
    config: { ...DEFAULT_SPA_CONFIG },
    domain: createDefaultDomainState()
  };
}

export async function loadState(): Promise<AppState> {
  try {
    const data = await get<AppState>(STORE_KEY);
    if (data) {
      data.config = { ...DEFAULT_SPA_CONFIG, ...data.config };
      data.config.temperatureScale = data.config.temperatureScale || 'C';
      data.config.timeFormat = data.config.timeFormat || '12h';
      data.config.defaultReadyTime = data.config.defaultReadyTime || '17:00';
      data.config.defaultHeatingTarget = data.config.defaultHeatingTarget || 40;
      data.config.heatingRateReferenceVolumeLiters = data.config.heatingRateReferenceVolumeLiters || 800;
      data.reminders = data.reminders || [];
      data.inventory = data.inventory || [];
      data.readings = data.readings || [];
      data.heatingSessions = data.heatingSessions || [];

      const defaultDomain = createDefaultDomainState();
      data.domain = data.domain || defaultDomain;
      data.domain.waterTests = data.domain.waterTests || [];
      data.domain.chemicalDoses = data.domain.chemicalDoses || [];
      data.domain.dosingEpisodes = data.domain.dosingEpisodes || [];
      data.domain.bathingEpisodes = data.domain.bathingEpisodes || [];
      data.domain.maintenanceEvents = data.domain.maintenanceEvents || [];
      data.domain.equipment = data.domain.equipment || defaultDomain.equipment;
      data.domain.products = data.domain.products || defaultDomain.products;

      // Built-in strip definitions are application data rather than user data.
      // Refresh them on load so corrected scales/order reach existing installs,
      // while retaining any genuinely custom methods added later.
      const builtInMethodIds = new Set(defaultDomain.testMethods.map(method => method.id));
      const customMethods = (data.domain.testMethods || []).filter(method => !builtInMethodIds.has(method.id));
      data.domain.testMethods = [...defaultDomain.testMethods, ...customMethods];

      data.domain.waterBodies = data.domain.waterBodies || defaultDomain.waterBodies;
      data.domain.activeWaterBodyId = data.domain.activeWaterBodyId || defaultDomain.activeWaterBodyId;
      data.domain.activeTestMethodId = data.domain.activeTestMethodId || defaultDomain.activeTestMethodId;

      // Correct locally cached 7-in-1 readings by the swatch position the user
      // selected, not by the incorrect numeric label that was previously stored.
      data.domain.waterTests = data.domain.waterTests.map(record => {
        if (record.testMethodId !== 'current-7-way') return record;
        const correction = correctLegacySevenWayReadings(record.readings);
        if (correction.alreadyCurrent || (correction.correctedCount === 0 && correction.unresolvedCount === 0)) return record;
        return { ...record, readings: correction.readings };
      });

      const active = data.domain.waterBodies.find(item => item.id === data.domain.activeWaterBodyId)
        || data.domain.waterBodies[0];
      if (active) {
        if (active.id === 'cleverspa-800' && !active.modelId) {
          active.manufacturerId = 'cleverspa';
          active.manufacturer = 'CleverSpa';
          active.modelId = 'cleverspa-current-800';
          active.model = 'Current 800 L Wi-Fi profile';
          active.modelCapacityLiters = 800;
          active.connectorId = 'cleverspa';
          active.connectivity = 'wifi';
        }
        data.config.waterBodyKind = active.kind || data.config.waterBodyKind;
        data.config.waterCapacityLiters = active.volumeLiters || data.config.waterCapacityLiters;
        data.config.manufacturerId = active.manufacturerId || data.config.manufacturerId;
        data.config.modelId = active.modelId || data.config.modelId;
        data.config.model = active.model || data.config.model;
        data.config.wifiSupported = (active.connectivity === 'wifi') || data.config.wifiSupported;
        data.config.connectorId = active.connectorId || data.config.connectorId;
      }
      return data;
    }
    return makeDefaultState();
  } catch (err) {
    console.error('Failed to load state', err);
    return makeDefaultState();
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    await set(STORE_KEY, state);
  } catch (err) {
    console.error('Failed to save state', err);
  }
}
