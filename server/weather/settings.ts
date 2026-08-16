import fs from 'node:fs/promises';
import path from 'node:path';
import type { WeatherLocation, WeatherSettings, WeatherTweaks } from './types';

export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
  samplingMode: 'nearest',
  triangulationRadiusKm: 12,
  tweaks: {
    installation: 'outdoor',
    windExposure: 'normal',
    solarExposure: 'mixed',
    overallInfluencePercent: 100
  }
};

function finiteCoordinate(value: unknown, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) throw new Error(`Coordinate must be between ${min} and ${max}.`);
  return numeric;
}

function validateLocation(value: unknown): WeatherLocation | undefined {
  if (value == null) return undefined;
  const input = value as Partial<WeatherLocation>;
  const source = input.source === 'phone' || input.source === 'lookup' || input.source === 'manual' ? input.source : 'manual';
  return {
    latitude: finiteCoordinate(input.latitude, -90, 90),
    longitude: finiteCoordinate(input.longitude, -180, 180),
    label: typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 160) : undefined,
    source
  };
}

function validateTweaks(value: unknown): WeatherTweaks {
  const input = (value || {}) as Partial<WeatherTweaks>;
  const installation = input.installation === 'indoor' ? 'indoor' : 'outdoor';
  const windExposure = input.windExposure === 'sheltered' || input.windExposure === 'exposed' ? input.windExposure : 'normal';
  const solarExposure = input.solarExposure === 'shade' || input.solarExposure === 'sun-trap' ? input.solarExposure : 'mixed';
  const overallInfluencePercent = Number(input.overallInfluencePercent ?? 100);
  if (!Number.isFinite(overallInfluencePercent) || overallInfluencePercent < 0 || overallInfluencePercent > 200) {
    throw new Error('Overall weather influence must be between 0% and 200%.');
  }
  return { installation, windExposure, solarExposure, overallInfluencePercent };
}

export function validateWeatherSettings(value: unknown): WeatherSettings {
  const input = (value || {}) as Partial<WeatherSettings>;
  const samplingMode = input.samplingMode === 'triangulate' ? 'triangulate' : 'nearest';
  const triangulationRadiusKm = Number(input.triangulationRadiusKm ?? DEFAULT_WEATHER_SETTINGS.triangulationRadiusKm);
  if (!Number.isFinite(triangulationRadiusKm) || triangulationRadiusKm < 1 || triangulationRadiusKm > 100) {
    throw new Error('Triangulation radius must be between 1 km and 100 km.');
  }
  return {
    location: validateLocation(input.location),
    samplingMode,
    triangulationRadiusKm,
    tweaks: validateTweaks(input.tweaks)
  };
}

export class WeatherSettingsStore {
  readonly settingsPath: string;

  constructor(baseDir = process.env.TELEMETRY_DIR || path.join(process.cwd(), 'data', 'telemetry')) {
    this.settingsPath = path.join(baseDir, 'weather-settings.json');
  }

  async load(): Promise<WeatherSettings> {
    try {
      return validateWeatherSettings(JSON.parse(await fs.readFile(this.settingsPath, 'utf8')));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') console.warn(`Unable to load weather settings; using defaults: ${error?.message || String(error)}`);
      return structuredClone(DEFAULT_WEATHER_SETTINGS);
    }
  }

  async save(settings: WeatherSettings) {
    const validated = validateWeatherSettings(settings);
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    const temporaryPath = `${this.settingsPath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, this.settingsPath);
    return validated;
  }
}
