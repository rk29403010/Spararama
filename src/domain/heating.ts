export const DEFAULT_HEATING_REFERENCE_VOLUME_LITERS = 800;
export const DEFAULT_HEATING_RATE_C_PER_HOUR = 1.5;
export const DEFAULT_HEAT_SOAK_MINUTES = 30;
export const DEFAULT_HEATER_POWER_WATTS = 1800;

export interface HeatingForecastSeries {
  time: number[];
  temperatureC: Array<number | null>;
  windSpeedMps: Array<number | null>;
  precipitationMm: Array<number | null>;
  shortwaveRadiationWm2: Array<number | null>;
}

export interface HeatingWeatherForecast {
  derived: HeatingForecastSeries;
  influence: {
    temperature: number;
    wind: number;
    solar: number;
    precipitation: number;
  };
  sourceCount?: number;
  samplingMode?: 'nearest' | 'triangulate';
}

export interface HeatingEstimateInput {
  mode: 'asap' | 'by-time';
  now: number;
  currentTemperatureC: number;
  targetTemperatureC: number;
  targetTime?: number;
  baseHeatingRateCPerHour: number;
  waterVolumeLiters: number;
  referenceVolumeLiters?: number;
  heatSoakMinutes?: number;
  heaterPowerWatts?: number;
  electricityRatePerKwh?: number;
  weather?: HeatingWeatherForecast | null;
}

export interface HeatingEstimate {
  targetTime: number;
  startTime: number;
  startTemperatureC: number;
  targetTemperatureC: number;
  baseHeatingRateCPerHour: number;
  effectiveHeatingRateCPerHour: number;
  hoursToHeat: number;
  heatSoakMinutes: number;
  totalHours: number;
  canMeetTarget: boolean;
  costEstimate: number;
  avgAmbientTemperatureC: number;
  avgWindSpeedKph: number;
  avgSolarRadiationWm2: number;
  avgPrecipitationMm: number;
  weatherSourceCount?: number;
  weatherSamplingMode?: 'nearest' | 'triangulate';
  weatherInfluence?: HeatingWeatherForecast['influence'];
}

function finitePositive(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function mean(values: Array<number | null | undefined>, fallback: number) {
  const usable = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : fallback;
}

export function volumeAdjustedHeatingRate(
  baseRateCPerHour: number,
  actualVolumeLiters: number,
  referenceVolumeLiters = DEFAULT_HEATING_REFERENCE_VOLUME_LITERS
) {
  const baseRate = finitePositive(baseRateCPerHour, DEFAULT_HEATING_RATE_C_PER_HOUR);
  const actualVolume = finitePositive(actualVolumeLiters, DEFAULT_HEATING_REFERENCE_VOLUME_LITERS);
  const referenceVolume = finitePositive(referenceVolumeLiters, DEFAULT_HEATING_REFERENCE_VOLUME_LITERS);

  return baseRate * (referenceVolume / actualVolume);
}

/**
 * Shared heating estimate used by both the browser Heating screen and server-side
 * voice/scheduling integrations. Keep this pure: callers supply observations,
 * forecast data and installation settings; the function owns the calculation.
 */
export function estimateHeatingPlan(input: HeatingEstimateInput): HeatingEstimate {
  const now = Number(input.now);
  const currentTemperatureC = Number(input.currentTemperatureC);
  const targetTemperatureC = Number(input.targetTemperatureC);
  if (![now, currentTemperatureC, targetTemperatureC].every(Number.isFinite)) {
    throw new Error('Heating estimate requires valid time and temperatures.');
  }

  const heatSoakMinutes = finiteNonNegative(input.heatSoakMinutes, 0);
  const soakHours = heatSoakMinutes / 60;
  const temperatureDifferenceC = Math.max(0, targetTemperatureC - currentTemperatureC);
  const baseHeatingRateCPerHour = volumeAdjustedHeatingRate(
    input.baseHeatingRateCPerHour,
    input.waterVolumeLiters,
    input.referenceVolumeLiters ?? DEFAULT_HEATING_REFERENCE_VOLUME_LITERS
  );

  let forecastWindowEnd: number;
  if (input.mode === 'asap') {
    const provisionalHours = (temperatureDifferenceC / Math.max(0.5, baseHeatingRateCPerHour)) + soakHours;
    forecastWindowEnd = now + Math.max(60_000, provisionalHours * 60 * 60 * 1000);
  } else {
    if (!Number.isFinite(input.targetTime) || Number(input.targetTime) <= now) {
      throw new Error('Heating target time must be in the future.');
    }
    forecastWindowEnd = Number(input.targetTime);
  }

  let avgAmbientTemperatureC = 15;
  let avgWindSpeedKph = 10;
  let avgSolarRadiationWm2 = 0;
  let avgPrecipitationMm = 0;
  let temperatureInfluence = 1;
  let windInfluence = 1;
  let solarInfluence = 0;
  let precipitationInfluence = 0;

  const weather = input.weather || undefined;
  if (weather) {
    const selectedIndexes = weather.derived.time
      .map((time, index) => ({ time, index }))
      .filter(item => item.time >= now && item.time <= forecastWindowEnd)
      .map(item => item.index);

    if (selectedIndexes.length) {
      avgAmbientTemperatureC = mean(selectedIndexes.map(index => weather.derived.temperatureC[index]), 15);
      avgWindSpeedKph = mean(selectedIndexes.map(index => weather.derived.windSpeedMps[index]), 10 / 3.6) * 3.6;
      avgSolarRadiationWm2 = mean(selectedIndexes.map(index => weather.derived.shortwaveRadiationWm2[index]), 0);
      avgPrecipitationMm = mean(selectedIndexes.map(index => weather.derived.precipitationMm[index]), 0);
    }

    temperatureInfluence = weather.influence.temperature;
    windInfluence = weather.influence.wind;
    solarInfluence = weather.influence.solar;
    precipitationInfluence = weather.influence.precipitation;
  }

  let effectiveHeatingRateCPerHour = baseHeatingRateCPerHour;
  if (avgAmbientTemperatureC < 15) {
    effectiveHeatingRateCPerHour -= (15 - avgAmbientTemperatureC) * 0.05 * temperatureInfluence;
  }
  if (avgWindSpeedKph > 10) {
    effectiveHeatingRateCPerHour -= ((avgWindSpeedKph - 10) / 5) * 0.05 * windInfluence;
  }
  if (avgSolarRadiationWm2 > 0) {
    effectiveHeatingRateCPerHour += Math.min(0.12, (avgSolarRadiationWm2 / 800) * 0.12) * solarInfluence;
  }
  if (avgPrecipitationMm > 0) {
    effectiveHeatingRateCPerHour -= Math.min(0.08, avgPrecipitationMm * 0.02) * precipitationInfluence;
  }
  effectiveHeatingRateCPerHour = Math.max(0.5, effectiveHeatingRateCPerHour);

  const hoursToHeat = temperatureDifferenceC / effectiveHeatingRateCPerHour;
  const totalHours = hoursToHeat + soakHours;
  const targetTime = input.mode === 'asap'
    ? now + Math.max(60_000, totalHours * 60 * 60 * 1000)
    : Number(input.targetTime);
  const startTime = input.mode === 'asap'
    ? now
    : targetTime - totalHours * 60 * 60 * 1000;

  const heaterPowerWatts = finiteNonNegative(input.heaterPowerWatts, 0);
  const electricityRatePerKwh = finiteNonNegative(input.electricityRatePerKwh, 0);
  const activeHeatingKwh = (heaterPowerWatts / 1000) * hoursToHeat;
  const soakKwh = (heaterPowerWatts / 1000) * soakHours * 0.5;
  const costEstimate = (activeHeatingKwh + soakKwh) * electricityRatePerKwh;

  return {
    targetTime,
    startTime,
    startTemperatureC: currentTemperatureC,
    targetTemperatureC,
    baseHeatingRateCPerHour,
    effectiveHeatingRateCPerHour,
    hoursToHeat,
    heatSoakMinutes,
    totalHours,
    canMeetTarget: input.mode === 'asap' || startTime >= now,
    costEstimate,
    avgAmbientTemperatureC,
    avgWindSpeedKph,
    avgSolarRadiationWm2,
    avgPrecipitationMm,
    ...(weather?.sourceCount !== undefined ? { weatherSourceCount: weather.sourceCount } : {}),
    ...(weather?.samplingMode ? { weatherSamplingMode: weather.samplingMode } : {}),
    ...(weather ? { weatherInfluence: { ...weather.influence } } : {})
  };
}
