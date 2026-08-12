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
      data.reminders = data.reminders || [];
      data.inventory = data.inventory || [];
      data.readings = data.readings || [];
      data.heatingSessions = data.heatingSessions || [];
      data.domain = data.domain || createDefaultDomainState();
      return data;
    }
    return makeDefaultState();
  } catch (err) {
    console.error("Failed to load state", err);
    return makeDefaultState();
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    await set(STORE_KEY, state);
  } catch (err) {
    console.error("Failed to save state", err);
  }
}
