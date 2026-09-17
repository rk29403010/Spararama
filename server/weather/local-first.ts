import { WeatherService, weatherInfluence } from './service';
import { WeatherSettingsStore } from './settings';
import type { CurrentWeatherSnapshot, CurrentWeatherSource, DerivedWeatherReading } from './types';

function derivedFromLocal(reading: CurrentWeatherSnapshot['raw'][number]): DerivedWeatherReading {
  return {
    method: 'single',
    sourceCount: 1,
    sourceLocationIds: [reading.sourceLocationId],
    temperatureC: reading.temperatureC,
    humidityPercent: reading.humidityPercent,
    pressureHpa: reading.pressureHpa,
    windSpeedMps: reading.windSpeedMps,
    windDirectionDegrees: reading.windDirectionDegrees,
    cloudPercent: reading.cloudPercent,
    precipitationMm: reading.precipitationMm,
    shortwaveRadiationWm2: reading.shortwaveRadiationWm2,
    observedAt: reading.observedAt
  };
}

export class LocalFirstWeatherService extends WeatherService {
  constructor(
    private readonly localCurrent?: CurrentWeatherSource,
    store?: WeatherSettingsStore,
    request: typeof fetch = fetch
  ) {
    super(store, request);
  }

  override async current(): Promise<CurrentWeatherSnapshot> {
    if (this.localCurrent) {
      const settings = await this.getSettings();
      try {
        const local = await this.localCurrent.readCurrent(settings);
        if (local) {
          return {
            settings,
            influence: weatherInfluence(settings),
            sources: [local.source],
            raw: [local.reading],
            derived: derivedFromLocal(local.reading)
          };
        }
      } catch {
        // A local station is optional. Fall through to forecast-provider current
        // conditions if it is offline or not ready yet.
      }
    }
    return super.current();
  }
}
