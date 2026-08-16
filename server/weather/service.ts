import { WeatherSettingsStore } from './settings';
import type {
  CurrentWeatherSnapshot,
  DerivedWeatherReading,
  RawWeatherReading,
  WeatherForecastSeries,
  WeatherForecastSnapshot,
  WeatherInfluence,
  WeatherSettings,
  WeatherSourceLocation
} from './types';

const EARTH_RADIUS_KM = 6371;

function average(values: Array<number | null | undefined>) {
  const usable = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : undefined;
}

function clamp(value: number, min = 0, max = 2) {
  return Math.max(min, Math.min(max, value));
}

function destination(latitude: number, longitude: number, distanceKm: number, bearingDegrees: number) {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const bearing = bearingDegrees * Math.PI / 180;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: lat2 * 180 / Math.PI, longitude: lon2 * 180 / Math.PI };
}

export function weatherInfluence(settings: WeatherSettings): WeatherInfluence {
  const overall = settings.tweaks.overallInfluencePercent / 100;
  const outdoor = settings.tweaks.installation === 'outdoor';
  const temperatureBase = outdoor ? 1 : 0.15;
  const windBase = outdoor ? ({ sheltered: 0.35, normal: 1, exposed: 1.4 } as const)[settings.tweaks.windExposure] : 0.05;
  const solarBase = outdoor ? ({ shade: 0.2, mixed: 0.7, 'sun-trap': 1.2 } as const)[settings.tweaks.solarExposure] : 0.05;
  const precipitationBase = outdoor ? (settings.tweaks.windExposure === 'sheltered' ? 0.5 : 1) : 0.05;
  return {
    overall: clamp(overall),
    temperature: clamp(temperatureBase * overall),
    wind: clamp(windBase * overall),
    solar: clamp(solarBase * overall),
    precipitation: clamp(precipitationBase * overall)
  };
}

function sourceLocations(settings: WeatherSettings): WeatherSourceLocation[] {
  if (!settings.location) return [];
  const { latitude, longitude } = settings.location;
  if (settings.samplingMode === 'nearest') {
    return [{ id: 'weather-point-1', provider: 'open-meteo', requestedLatitude: latitude, requestedLongitude: longitude, label: 'Nearest weather point' }];
  }
  return [0, 120, 240].map((bearing, index) => {
    const point = destination(latitude, longitude, settings.triangulationRadiusKm, bearing);
    return {
      id: `weather-point-${index + 1}`,
      provider: 'open-meteo' as const,
      requestedLatitude: point.latitude,
      requestedLongitude: point.longitude,
      label: `Triangulation point ${index + 1}`
    };
  });
}

function aggregateReadings(readings: RawWeatherReading[]): DerivedWeatherReading {
  return {
    method: readings.length <= 1 ? 'single' : 'mean',
    sourceCount: readings.length,
    sourceLocationIds: readings.map(reading => reading.sourceLocationId),
    temperatureC: average(readings.map(reading => reading.temperatureC)),
    humidityPercent: average(readings.map(reading => reading.humidityPercent)),
    windSpeedMps: average(readings.map(reading => reading.windSpeedMps)),
    windDirectionDegrees: average(readings.map(reading => reading.windDirectionDegrees)),
    cloudPercent: average(readings.map(reading => reading.cloudPercent)),
    precipitationMm: average(readings.map(reading => reading.precipitationMm)),
    shortwaveRadiationWm2: average(readings.map(reading => reading.shortwaveRadiationWm2)),
    observedAt: average(readings.map(reading => reading.observedAt))
  };
}

function emptySeries(): WeatherForecastSeries {
  return { time: [], temperatureC: [], windSpeedMps: [], cloudPercent: [], precipitationMm: [], shortwaveRadiationWm2: [] };
}

function parseSeries(response: any): WeatherForecastSeries {
  const hourly = response?.hourly || {};
  const times = Array.isArray(hourly.time) ? hourly.time.map((value: unknown) => Number(value) * 1000) : [];
  const field = (name: string) => times.map((_, index) => {
    const value = Number(hourly?.[name]?.[index]);
    return Number.isFinite(value) ? value : null;
  });
  return {
    time: times,
    temperatureC: field('temperature_2m'),
    windSpeedMps: field('wind_speed_10m'),
    cloudPercent: field('cloud_cover'),
    precipitationMm: field('precipitation'),
    shortwaveRadiationWm2: field('shortwave_radiation')
  };
}

function aggregateSeries(series: WeatherForecastSeries[]): WeatherForecastSeries {
  if (!series.length) return emptySeries();
  const length = Math.max(...series.map(item => item.time.length));
  const output = emptySeries();
  for (let index = 0; index < length; index += 1) {
    const timestamp = series.map(item => item.time[index]).find(value => Number.isFinite(value));
    if (!timestamp) continue;
    output.time.push(timestamp);
    const pushAverage = (target: Array<number | null>, selector: (item: WeatherForecastSeries) => number | null | undefined) => {
      const value = average(series.map(selector));
      target.push(value ?? null);
    };
    pushAverage(output.temperatureC, item => item.temperatureC[index]);
    pushAverage(output.windSpeedMps, item => item.windSpeedMps[index]);
    pushAverage(output.cloudPercent, item => item.cloudPercent[index]);
    pushAverage(output.precipitationMm, item => item.precipitationMm[index]);
    pushAverage(output.shortwaveRadiationWm2, item => item.shortwaveRadiationWm2[index]);
  }
  return output;
}

export class WeatherService {
  private settings: WeatherSettings | null = null;

  constructor(private readonly store = new WeatherSettingsStore()) {}

  async getSettings() {
    if (!this.settings) this.settings = await this.store.load();
    return structuredClone(this.settings);
  }

  async setSettings(settings: WeatherSettings) {
    this.settings = await this.store.save(settings);
    return structuredClone(this.settings);
  }

  async lookup(query: string) {
    const term = query.trim();
    if (term.length < 2) return [];
    const params = new URLSearchParams({ name: term, count: '8', language: 'en', countryCode: 'GB', format: 'json' });
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
    if (!response.ok) throw new Error(`Location lookup failed (${response.status}).`);
    const data: any = await response.json();
    return (data?.results || []).map((item: any) => ({
      id: String(item.id),
      name: item.name,
      admin1: item.admin1,
      admin2: item.admin2,
      country: item.country,
      postcodes: item.postcodes,
      latitude: item.latitude,
      longitude: item.longitude,
      timezone: item.timezone
    }));
  }

  async current(): Promise<CurrentWeatherSnapshot> {
    const settings = await this.getSettings();
    const sources = sourceLocations(settings);
    if (!sources.length) throw new Error('Spa location is not configured.');
    const params = new URLSearchParams({
      latitude: sources.map(source => source.requestedLatitude).join(','),
      longitude: sources.map(source => source.requestedLongitude).join(','),
      current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,shortwave_radiation',
      wind_speed_unit: 'ms',
      timeformat: 'unixtime'
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) throw new Error(`Weather lookup failed (${response.status}).`);
    const payload: any = await response.json();
    const rows = Array.isArray(payload) ? payload : [payload];
    const raw = rows.map((row: any, index: number): RawWeatherReading => {
      const source = sources[index];
      if (source) {
        source.resolvedLatitude = Number.isFinite(Number(row?.latitude)) ? Number(row.latitude) : undefined;
        source.resolvedLongitude = Number.isFinite(Number(row?.longitude)) ? Number(row.longitude) : undefined;
      }
      const current = row?.current || {};
      const numeric = (name: string) => Number.isFinite(Number(current[name])) ? Number(current[name]) : undefined;
      return {
        source: 'open-meteo', provider: 'open-meteo', sourceLocationId: source?.id || `weather-point-${index + 1}`, station: source?.label,
        latitude: source?.resolvedLatitude, longitude: source?.resolvedLongitude,
        temperatureC: numeric('temperature_2m'), humidityPercent: numeric('relative_humidity_2m'), windSpeedMps: numeric('wind_speed_10m'),
        windDirectionDegrees: numeric('wind_direction_10m'), cloudPercent: numeric('cloud_cover'), precipitationMm: numeric('precipitation'),
        shortwaveRadiationWm2: numeric('shortwave_radiation'), observedAt: Number.isFinite(Number(current.time)) ? Number(current.time) * 1000 : Date.now()
      };
    });
    return { settings, influence: weatherInfluence(settings), sources, raw, derived: aggregateReadings(raw) };
  }

  async forecast(days = 2): Promise<WeatherForecastSnapshot> {
    const settings = await this.getSettings();
    const sources = sourceLocations(settings);
    if (!sources.length) throw new Error('Spa location is not configured.');
    const safeDays = Math.max(1, Math.min(8, Math.floor(days)));
    const params = new URLSearchParams({
      latitude: sources.map(source => source.requestedLatitude).join(','),
      longitude: sources.map(source => source.requestedLongitude).join(','),
      hourly: 'temperature_2m,wind_speed_10m,cloud_cover,precipitation,shortwave_radiation',
      wind_speed_unit: 'ms',
      timeformat: 'unixtime',
      forecast_days: String(safeDays)
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) throw new Error(`Weather forecast failed (${response.status}).`);
    const payload: any = await response.json();
    const rows = Array.isArray(payload) ? payload : [payload];
    const raw = rows.map((row: any, index: number) => {
      const source = sources[index];
      if (source) {
        source.resolvedLatitude = Number.isFinite(Number(row?.latitude)) ? Number(row.latitude) : undefined;
        source.resolvedLongitude = Number.isFinite(Number(row?.longitude)) ? Number(row.longitude) : undefined;
      }
      return { sourceLocationId: source?.id || `weather-point-${index + 1}`, series: parseSeries(row) };
    });
    return { settings, influence: weatherInfluence(settings), sources, raw, derived: aggregateSeries(raw.map(item => item.series)) };
  }
}
