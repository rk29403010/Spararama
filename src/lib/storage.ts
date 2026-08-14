import { get, set } from 'idb-keyval';
import { AppState, DEFAULT_SPA_CONFIG } from '../types';
import { createDefaultDomainState } from '../domain/defaults';

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
      data.domain.maintenanceEvents = data.domain.maintenanceEvents || [];
      data.domain.equipment = data.domain.equipment || defaultDomain.equipment;
      data.domain.products = data.domain.products || defaultDomain.products;
      data.domain.testMethods = data.domain.testMethods || defaultDomain.testMethods;
      data.domain.waterBodies = data.domain.waterBodies || defaultDomain.waterBodies;
      data.domain.activeWaterBodyId = data.domain.activeWaterBodyId || defaultDomain.activeWaterBodyId;
      data.domain.activeTestMethodId = data.domain.activeTestMethodId || defaultDomain.activeTestMethodId;

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
