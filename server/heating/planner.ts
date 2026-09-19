import {
  DEFAULT_HEATER_POWER_WATTS,
  DEFAULT_HEATING_RATE_C_PER_HOUR,
  DEFAULT_HEATING_REFERENCE_VOLUME_LITERS,
  DEFAULT_HEAT_SOAK_MINUTES,
  estimateHeatingPlan,
  type HeatingWeatherForecast
} from '../../src/domain/heating';
import type { SpaAdapter } from '../spa/types';
import type { WeatherForecastSnapshot } from '../weather/types';
import type { HeatingSchedule } from './types';

const DEFAULT_ELECTRICITY_RATE_PER_KWH = 0.2086;
const DEFAULT_FORECAST_CACHE_MS = 15 * 60_000;
export const HEATING_OUTLOOK_MODEL_VERSION = 'baseline-weather-v1';

interface HeatingScheduleSource {
  listSchedules?(): Promise<HeatingSchedule[]>;
  createSchedule?(input: {
    id?: string;
    startTime: number;
    targetTime: number;
    startTemperatureC: number;
    targetTemperatureC: number;
    autoStartPreferred: boolean;
    heatSoakMinutes?: number;
    alertOnTargetReached?: boolean;
    alertOnHeatSoakComplete?: boolean;
    sessionData?: Record<string, unknown>;
  }): Promise<unknown>;
}

interface HeatingWeatherSource {
  forecast(days?: number): Promise<WeatherForecastSnapshot>;
}

export interface HeatingPlannerOptions {
  baseHeatingRateCPerHour?: number;
  waterVolumeLiters?: number;
  referenceVolumeLiters?: number;
  heatSoakMinutes?: number;
  heaterPowerWatts?: number;
  electricityRatePerKwh?: number;
  defaultTargetTemperatureC?: number;
  forecastCacheMs?: number;
}

export type HeatingOutlookScenario = 'assume-start-now' | 'continue-heating' | 'unavailable';

export interface HeatingOutlook {
  generatedAt: number;
  modelVersion: string;
  scenario: HeatingOutlookScenario;
  requestedBathingTime?: number;
  requestedScheduleId?: string;
  requestedScheduleStatus?: HeatingSchedule['status'];
  requestedTargetTemperatureC?: number;
  estimatedBathingTime?: number;
  currentTemperatureC?: number;
  targetTemperatureC?: number;
  heaterOn?: boolean;
  weatherMode: 'forecast' | 'neutral';
  weatherError?: string;
  unavailableReason?: string;
  projection?: {
    effectiveHeatingRateCPerHour: number;
    hoursToHeat: number;
    heatSoakMinutes: number;
    costEstimate: number;
    avgAmbientTemperatureC: number;
    avgWindSpeedKph: number;
    avgSolarRadiationWm2: number;
    avgPrecipitationMm: number;
  };
}

export interface HeatingReadyAtPlan {
  targetTime: number;
  startTime: number;
  targetTemperatureC: number;
  startTemperatureC: number;
  heatSoakMinutes: number;
  effectiveHeatingRateCPerHour: number;
  canMeetTarget: boolean;
  autoStartPreferred: boolean;
  weatherAdjusted: boolean;
  weatherError?: string;
  schedule: unknown;
}

export interface HeatingReadyAtRequest {
  scheduleId?: string;
  targetTime: number;
  targetTemperatureC?: number;
  heatSoakMinutes?: number;
  alertOnTargetReached?: boolean;
  alertOnHeatSoakComplete?: boolean;
  sessionData?: Record<string, unknown>;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function environmentNumber(...names: string[]) {
  for (const name of names) {
    const raw = String(process.env[name] || '').trim();
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function positive(value: number | undefined, fallback: number) {
  return finiteNumber(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number | undefined, fallback: number) {
  return finiteNumber(value) && value >= 0 ? value : fallback;
}

function weatherForHeating(forecast: WeatherForecastSnapshot | undefined): HeatingWeatherForecast | undefined {
  if (!forecast) return undefined;
  return {
    derived: forecast.derived,
    influence: forecast.influence,
    sourceCount: forecast.sources.length,
    samplingMode: forecast.settings.samplingMode
  };
}

function requestedSchedule(schedules: HeatingSchedule[], now: number) {
  return schedules
    .filter(schedule => schedule.status !== 'cancelled' && finiteNumber(schedule.targetTime))
    .sort((a, b) => b.createdAt - a.createdAt)
    .find(schedule => schedule.status !== 'ready' || schedule.targetTime >= now);
}

function remainingHeatSoakMinutes(schedule: HeatingSchedule | undefined, heaterOn: boolean, now: number, fallback: number) {
  if (!schedule) return fallback;
  if (schedule.heatSoakCompletedAt) return 0;
  const plannedMinutes = nonNegative(schedule.heatSoakMinutes, fallback);
  if (!heaterOn || !finiteNumber(schedule.soakStartedAt)) return plannedMinutes;
  const elapsedMinutes = Math.max(0, (now - schedule.soakStartedAt) / 60_000);
  return Math.max(0, plannedMinutes - elapsedMinutes);
}

export class HeatingPlanner {
  private readonly baseHeatingRateCPerHour: number;
  private readonly waterVolumeLiters: number;
  private readonly referenceVolumeLiters: number;
  private readonly heatSoakMinutes: number;
  private readonly heaterPowerWatts: number;
  private readonly electricityRatePerKwh: number;
  private readonly defaultTargetTemperatureC?: number;
  private readonly forecastCacheMs: number;
  private forecastCache?: { fetchedAt: number; forecast: WeatherForecastSnapshot };

  constructor(
    private readonly spa: SpaAdapter,
    private readonly schedules: HeatingScheduleSource,
    private readonly weather?: HeatingWeatherSource,
    options: HeatingPlannerOptions = {}
  ) {
    this.baseHeatingRateCPerHour = positive(
      options.baseHeatingRateCPerHour ?? environmentNumber('HEATING_RATE_C_PER_HOUR', 'ALEXA_HEATING_RATE_C_PER_HOUR'),
      DEFAULT_HEATING_RATE_C_PER_HOUR
    );
    this.waterVolumeLiters = positive(
      options.waterVolumeLiters ?? environmentNumber('HEATING_WATER_VOLUME_LITERS', 'ALEXA_WATER_VOLUME_LITERS'),
      DEFAULT_HEATING_REFERENCE_VOLUME_LITERS
    );
    this.referenceVolumeLiters = positive(
      options.referenceVolumeLiters ?? environmentNumber('HEATING_REFERENCE_VOLUME_LITERS', 'ALEXA_HEATING_RATE_REFERENCE_VOLUME_LITERS'),
      DEFAULT_HEATING_REFERENCE_VOLUME_LITERS
    );
    this.heatSoakMinutes = nonNegative(
      options.heatSoakMinutes ?? environmentNumber('HEATING_HEAT_SOAK_MINUTES', 'ALEXA_HEAT_SOAK_MINUTES'),
      DEFAULT_HEAT_SOAK_MINUTES
    );
    this.heaterPowerWatts = nonNegative(
      options.heaterPowerWatts ?? environmentNumber('HEATING_HEATER_POWER_WATTS', 'ALEXA_HEATER_POWER_WATTS'),
      DEFAULT_HEATER_POWER_WATTS
    );
    this.electricityRatePerKwh = nonNegative(
      options.electricityRatePerKwh ?? environmentNumber('HEATING_ELECTRICITY_RATE_PER_KWH', 'ALEXA_ELECTRICITY_RATE_PER_KWH'),
      DEFAULT_ELECTRICITY_RATE_PER_KWH
    );
    const defaultTarget = options.defaultTargetTemperatureC
      ?? environmentNumber('HEATING_DEFAULT_TARGET_C', 'ALEXA_DEFAULT_READY_TARGET_C');
    this.defaultTargetTemperatureC = finiteNumber(defaultTarget) ? defaultTarget : undefined;
    this.forecastCacheMs = positive(options.forecastCacheMs, DEFAULT_FORECAST_CACHE_MS);
  }

  async scheduleReadyAt(request: HeatingReadyAtRequest, now = Date.now()): Promise<HeatingReadyAtPlan> {
    if (!this.schedules.createSchedule) {
      throw new Error('Heating scheduler is not configured for ready-at requests.');
    }
    if (!finiteNumber(request.targetTime) || request.targetTime <= now) {
      throw new Error('Heating target time must be in the future.');
    }

    const status = await this.spa.getStatus();
    const targetTemperatureC = finiteNumber(request.targetTemperatureC)
      ? request.targetTemperatureC
      : finiteNumber(status.targetTemperatureC)
        ? status.targetTemperatureC
        : this.defaultTargetTemperatureC;

    if (!finiteNumber(status.waterTemperatureC) || !finiteNumber(targetTemperatureC)) {
      throw new Error('A current and target temperature are required to plan heating.');
    }

    let forecast: WeatherForecastSnapshot | undefined;
    let weatherError: string | undefined;
    if (this.weather) {
      try {
        forecast = await this.forecast(now);
      } catch (error) {
        weatherError = error instanceof Error ? error.message : String(error);
      }
    }

    const heatSoakMinutes = finiteNumber(request.heatSoakMinutes)
      ? Math.max(0, request.heatSoakMinutes)
      : this.heatSoakMinutes;
    const estimate = estimateHeatingPlan({
      mode: 'by-time',
      now,
      currentTemperatureC: status.waterTemperatureC,
      targetTemperatureC,
      targetTime: request.targetTime,
      baseHeatingRateCPerHour: this.baseHeatingRateCPerHour,
      waterVolumeLiters: this.waterVolumeLiters,
      referenceVolumeLiters: this.referenceVolumeLiters,
      heatSoakMinutes,
      heaterPowerWatts: this.heaterPowerWatts,
      electricityRatePerKwh: this.electricityRatePerKwh,
      weather: weatherForHeating(forecast)
    });

    const startTime = Math.max(now, estimate.startTime);
    const autoStartPreferred = status.connected && status.transport !== 'manual';
    const schedule = await this.schedules.createSchedule({
      ...(request.scheduleId ? { id: request.scheduleId } : {}),
      startTime,
      targetTime: estimate.targetTime,
      startTemperatureC: estimate.startTemperatureC,
      targetTemperatureC: estimate.targetTemperatureC,
      autoStartPreferred,
      heatSoakMinutes: estimate.heatSoakMinutes,
      alertOnTargetReached: request.alertOnTargetReached !== false,
      alertOnHeatSoakComplete: request.alertOnHeatSoakComplete !== false,
      sessionData: {
        ...(request.sessionData || {}),
        estimation: 'shared-heating-model',
        weatherMode: forecast ? 'forecast' : 'neutral',
        baseHeatingRateCPerHour: estimate.baseHeatingRateCPerHour,
        effectiveHeatingRateCPerHour: estimate.effectiveHeatingRateCPerHour,
        waterVolumeLiters: this.waterVolumeLiters,
        heatingRateReferenceVolumeLiters: this.referenceVolumeLiters,
        heatSoakMinutes: estimate.heatSoakMinutes,
        avgAmbientTemperatureC: estimate.avgAmbientTemperatureC,
        avgWindSpeedKph: estimate.avgWindSpeedKph,
        avgSolarRadiationWm2: estimate.avgSolarRadiationWm2,
        avgPrecipitationMm: estimate.avgPrecipitationMm,
        weatherSourceCount: estimate.weatherSourceCount,
        weatherSamplingMode: estimate.weatherSamplingMode,
        ...(weatherError ? { weatherError } : {})
      }
    });

    return {
      targetTime: estimate.targetTime,
      startTime,
      targetTemperatureC: estimate.targetTemperatureC,
      startTemperatureC: estimate.startTemperatureC,
      heatSoakMinutes: estimate.heatSoakMinutes,
      effectiveHeatingRateCPerHour: estimate.effectiveHeatingRateCPerHour,
      canMeetTarget: estimate.canMeetTarget,
      autoStartPreferred,
      weatherAdjusted: Boolean(forecast),
      ...(weatherError ? { weatherError } : {}),
      schedule
    };
  }

  async getOutlook(now = Date.now()): Promise<HeatingOutlook> {
    const schedules = this.schedules.listSchedules
      ? await this.schedules.listSchedules().catch(() => [] as HeatingSchedule[])
      : [];
    const request = requestedSchedule(schedules, now);
    const requestFields = request ? {
      requestedBathingTime: request.targetTime,
      requestedScheduleId: request.id,
      requestedScheduleStatus: request.status,
      requestedTargetTemperatureC: request.targetTemperatureC
    } : {};

    let status;
    try {
      status = await this.spa.getStatus();
    } catch (error) {
      return {
        generatedAt: now,
        modelVersion: HEATING_OUTLOOK_MODEL_VERSION,
        scenario: 'unavailable',
        weatherMode: 'neutral',
        ...requestFields,
        unavailableReason: error instanceof Error ? error.message : String(error)
      };
    }

    const targetTemperatureC = finiteNumber(status.targetTemperatureC)
      ? status.targetTemperatureC
      : request?.targetTemperatureC ?? this.defaultTargetTemperatureC;

    if (!status.connected || status.transport === 'manual' || !finiteNumber(status.waterTemperatureC) || !finiteNumber(targetTemperatureC)) {
      return {
        generatedAt: now,
        modelVersion: HEATING_OUTLOOK_MODEL_VERSION,
        scenario: 'unavailable',
        weatherMode: 'neutral',
        ...requestFields,
        heaterOn: Boolean(status.heaterOn),
        unavailableReason: 'A live water temperature and target temperature are required for a bathing-time estimate.'
      };
    }

    let forecast: WeatherForecastSnapshot | undefined;
    let weatherError: string | undefined;
    if (this.weather) {
      try {
        forecast = await this.forecast(now);
      } catch (error) {
        weatherError = error instanceof Error ? error.message : String(error);
      }
    }

    const heatSoakMinutes = remainingHeatSoakMinutes(request, Boolean(status.heaterOn), now, this.heatSoakMinutes);
    const estimate = estimateHeatingPlan({
      mode: 'asap',
      now,
      currentTemperatureC: status.waterTemperatureC,
      targetTemperatureC,
      baseHeatingRateCPerHour: this.baseHeatingRateCPerHour,
      waterVolumeLiters: this.waterVolumeLiters,
      referenceVolumeLiters: this.referenceVolumeLiters,
      heatSoakMinutes,
      heaterPowerWatts: this.heaterPowerWatts,
      electricityRatePerKwh: this.electricityRatePerKwh,
      weather: weatherForHeating(forecast)
    });

    return {
      generatedAt: now,
      modelVersion: HEATING_OUTLOOK_MODEL_VERSION,
      scenario: status.heaterOn ? 'continue-heating' : 'assume-start-now',
      ...requestFields,
      estimatedBathingTime: estimate.totalHours <= 0 ? now : estimate.targetTime,
      currentTemperatureC: status.waterTemperatureC,
      targetTemperatureC,
      heaterOn: Boolean(status.heaterOn),
      weatherMode: forecast ? 'forecast' : 'neutral',
      ...(weatherError ? { weatherError } : {}),
      projection: {
        effectiveHeatingRateCPerHour: estimate.effectiveHeatingRateCPerHour,
        hoursToHeat: estimate.hoursToHeat,
        heatSoakMinutes: estimate.heatSoakMinutes,
        costEstimate: estimate.costEstimate,
        avgAmbientTemperatureC: estimate.avgAmbientTemperatureC,
        avgWindSpeedKph: estimate.avgWindSpeedKph,
        avgSolarRadiationWm2: estimate.avgSolarRadiationWm2,
        avgPrecipitationMm: estimate.avgPrecipitationMm
      }
    };
  }

  private async forecast(now: number) {
    if (this.forecastCache && now - this.forecastCache.fetchedAt < this.forecastCacheMs) {
      return this.forecastCache.forecast;
    }
    if (!this.weather) throw new Error('Weather forecast service is unavailable.');
    const forecast = await this.weather.forecast(2);
    this.forecastCache = { fetchedAt: now, forecast };
    return forecast;
  }
}
