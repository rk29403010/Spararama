import type { SpaDomainState, WaterBodyKind } from './domain/models';

export interface ChemicalInventory { id: string; name: string; ingredientType: string; quantity: string; addedAt: number; }
export interface TestReading { id: string; timestamp: number; chlorine: number | null; bromine: number | null; ph: number | null; alkalinity: number | null; recommendation: string; }
export interface HeatingSession {
  id: string;
  targetTemp: number;
  targetTime: number;
  startTemp: number;
  startTime: number;
  ambientTempAvg: number;
  avgWindSpeed?: number;
  avgSolarRadiationWm2?: number;
  weatherSourceCount?: number;
  weatherSamplingMode?: 'nearest' | 'triangulate';
  weatherInfluence?: { temperature: number; wind: number; solar: number; precipitation: number; };
  expectedDurationHours: number;
  actualDurationHours?: number;
  costEstimate: number;
}

export interface SpaConfig {
  model: string;
  waterBodyKind: WaterBodyKind;
  manufacturerId?: string;
  modelId?: string;
  waterCapacityLiters: number;
  capacityOverrideLiters?: number;
  wifiSupported?: boolean;
  connectorId?: string;
  maxTemp: number;
  heaterPowerWatts: number;
  pumpPowerWatts: number;
  electricityRatePerKwh: number;
  baseHeatingRatePerHour: number;
  heatingRateReferenceVolumeLiters: number;
  heatLossRatePerHour: number;
  temperatureScale: 'C' | 'F';
  defaultReadyTime: string;
  timeFormat: '12h' | '24h';
  defaultHeatingTarget: number;
  heatSoakMinutes: number;
  alertOnTargetReached: boolean;
  alertOnHeatSoakComplete: boolean;
}

export const DEFAULT_SPA_CONFIG: SpaConfig = {
  model: 'Current 800 L Wi-Fi profile', waterBodyKind: 'spa', manufacturerId: 'cleverspa', modelId: 'cleverspa-current-800',
  waterCapacityLiters: 800, wifiSupported: true, connectorId: 'cleverspa', maxTemp: 40, heaterPowerWatts: 1800, pumpPowerWatts: 600,
  electricityRatePerKwh: 0.2086, baseHeatingRatePerHour: 1.5, heatingRateReferenceVolumeLiters: 800, heatLossRatePerHour: 0.5,
  temperatureScale: 'C', defaultReadyTime: '17:00', timeFormat: '12h', defaultHeatingTarget: 40, heatSoakMinutes: 30,
  alertOnTargetReached: true, alertOnHeatSoakComplete: true
};

export interface ActiveReminder { id: string; type: 'start_heating' | 'tub_ready'; scheduledTime: number; sessionData?: any; }
export interface AppState { inventory: ChemicalInventory[]; readings: TestReading[]; heatingSessions: HeatingSession[]; reminders: ActiveReminder[]; config: SpaConfig; domain: SpaDomainState; }
