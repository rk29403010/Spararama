import type { SpaDomainState } from './domain/models';

export interface ChemicalInventory {
  id: string;
  name: string;
  ingredientType: string;
  quantity: string;
  addedAt: number;
}

export interface TestReading {
  id: string;
  timestamp: number;
  chlorine: number | null;
  bromine: number | null;
  ph: number | null;
  alkalinity: number | null;
  recommendation: string;
}

export interface HeatingSession {
  id: string;
  targetTemp: number;
  targetTime: number; // Unix timestamp
  startTemp: number;
  startTime: number; // Unix timestamp
  ambientTempAvg: number;
  avgWindSpeed?: number;
  expectedDurationHours: number;
  actualDurationHours?: number;
  costEstimate: number;
}

export interface SpaConfig {
  model: string;
  waterCapacityLiters: number;
  maxTemp: number;
  heaterPowerWatts: number;
  pumpPowerWatts: number;
  electricityRatePerKwh: number;
  baseHeatingRatePerHour: number; // Degrees C per hour in ideal conditions
  heatLossRatePerHour: number; // Degrees C lost per hour at ambient
  temperatureScale: 'C' | 'F';
  defaultReadyTime: string;
  timeFormat: '12h' | '24h';
  defaultHeatingTarget: number;
  heatSoakMinutes: number;
}

export const DEFAULT_SPA_CONFIG: SpaConfig = {
  model: "CleverSpa 800L Circular",
  waterCapacityLiters: 800,
  maxTemp: 40,
  heaterPowerWatts: 1800,
  pumpPowerWatts: 600,
  electricityRatePerKwh: 0.2086,
  baseHeatingRatePerHour: 1.5,
  heatLossRatePerHour: 0.5,
  temperatureScale: 'C',
  defaultReadyTime: '17:00',
  timeFormat: '12h',
  defaultHeatingTarget: 40,
  heatSoakMinutes: 30
};

export interface ActiveReminder {
  id: string;
  type: 'start_heating' | 'tub_ready';
  scheduledTime: number;
  sessionData?: any;
}

export interface AppState {
  inventory: ChemicalInventory[];
  readings: TestReading[];
  heatingSessions: HeatingSession[];
  reminders: ActiveReminder[];
  config: SpaConfig;
  domain: SpaDomainState;
}
