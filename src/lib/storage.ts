import { get, set } from 'idb-keyval';
import { AppState, DEFAULT_SPA_CONFIG } from '../types';

const STORE_KEY = 'hottub_state';

const defaultState: AppState = {
  inventory: [],
  readings: [],
  heatingSessions: [],
  reminders: [],
  config: DEFAULT_SPA_CONFIG
};

export async function loadState(): Promise<AppState> {
  try {
    const data = await get<AppState>(STORE_KEY);
    if (data) {
      // Merge with defaults to ensure new fields are populated
      data.config = { ...DEFAULT_SPA_CONFIG, ...data.config };
      data.config.temperatureScale = data.config.temperatureScale || 'C';
      data.config.timeFormat = data.config.timeFormat || '12h';
      data.config.defaultReadyTime = data.config.defaultReadyTime || '17:00';
      data.config.defaultHeatingTarget = data.config.defaultHeatingTarget || 40;
      data.reminders = data.reminders || [];
      return data;
    }
    return defaultState;
  } catch (err) {
    console.error("Failed to load state", err);
    return defaultState;
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    await set(STORE_KEY, state);
  } catch (err) {
    console.error("Failed to save state", err);
  }
}
