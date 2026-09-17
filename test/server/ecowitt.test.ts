import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WEATHER_SETTINGS } from '../../server/weather/settings';
import { LocalFirstWeatherService } from '../../server/weather/local-first';
import {
  createEcowittLanIntegration,
  EcowittLanClient,
  EcowittSensorSource,
  EcowittCurrentWeatherSource,
  resolveEcowittConfig
} from '../../server/sensors/ecowitt';

const LIVE_PAYLOAD = {
  common_list: [
    { id: '0x02', val: '68.0', unit: 'F' },
    { id: '0x07', val: '73%' },
    { id: '0x09', val: '29.92 inHg' },
    { id: '0x0A', val: '225' },
    { id: '0x0B', val: '10.00 mph' },
    { id: '0x0C', val: '16.00 mph' },
    { id: '0x15', val: '500.00 W/m2' },
    { id: '0x17', val: '4' }
  ],
  rain: [
    { id: '0x0E', val: '0.10 in/Hr' },
    { id: '0x10', val: '0.25 in' }
  ],
  ch_aisle: [
    { channel: '1', name: 'Spa patio', temp: '77.0', unit: 'F', humidity: '60%' }
  ],
  ch_soil: [
    { channel: '2', name: 'Planter', humidity: '44%' }
  ]
};

test('Ecowitt LAN source normalises main weather and add-on sensor channels', async () => {
  let calls = 0;
  const client = new EcowittLanClient({
    endpoint: new URL('http://192.0.2.20/get_livedata_info'),
    timeoutMs: 1000,
    cacheMs: 10_000,
    locationLabel: 'Garden weather station'
  }, async input => {
    calls += 1;
    assert.equal(String(input), 'http://192.0.2.20/get_livedata_info');
    return new Response(JSON.stringify(LIVE_PAYLOAD), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const sensors = await new EcowittSensorSource(client).read();
  const current = await new EcowittCurrentWeatherSource(client).readCurrent({
    ...DEFAULT_WEATHER_SETTINGS,
    location: { latitude: 52.59, longitude: 1.52, label: 'Spa', source: 'manual' }
  });

  assert.equal(calls, 1, 'sensor + current-weather reads should share the short live-data cache');
  assert.ok(current);
  assert.equal(current?.reading.provider, 'ecowitt');
  assert.ok(Math.abs((current?.reading.temperatureC ?? 0) - 20) < 0.001);
  assert.equal(current?.reading.humidityPercent, 73);
  assert.ok(Math.abs((current?.reading.pressureHpa ?? 0) - 1013.207) < 0.01);
  assert.ok(Math.abs((current?.reading.windSpeedMps ?? 0) - 4.4704) < 0.0001);
  assert.equal(current?.reading.windDirectionDegrees, 225);
  assert.equal(current?.reading.shortwaveRadiationWm2, 500);

  const patioTemp = sensors.find(reading => reading.id === 'ecowitt.channel.aisle.1.temperature');
  assert.ok(patioTemp);
  assert.ok(Math.abs(Number(patioTemp?.value) - 25) < 0.001);
  assert.equal(patioTemp?.location, 'Spa patio');
  assert.equal(sensors.find(reading => reading.id === 'ecowitt.channel.aisle.1.humidity')?.value, 60);
  assert.equal(sensors.find(reading => reading.id === 'ecowitt.channel.soil.2.moisture')?.value, 44);
  assert.ok(Math.abs(Number(sensors.find(reading => reading.id === 'ecowitt.weather.rain-rate')?.value) - 2.54) < 0.001);
  assert.ok(Math.abs(Number(sensors.find(reading => reading.id === 'ecowitt.weather.wind-gust')?.value) - 7.15264) < 0.0001);
});

test('Local-first weather uses Ecowitt current conditions without replacing Open-Meteo forecasts', async () => {
  const integration = createEcowittLanIntegration({
    ECOWITT_HOST: '192.0.2.21',
    ECOWITT_CACHE_MS: '10000',
    ECOWITT_LOCATION_LABEL: 'Back garden'
  }, async () => new Response(JSON.stringify(LIVE_PAYLOAD), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.ok(integration);

  let providerRequests = 0;
  const settings = {
    ...DEFAULT_WEATHER_SETTINGS,
    location: { latitude: 52.59, longitude: 1.52, label: 'Spa', source: 'manual' as const }
  };
  const store = {
    load: async () => settings,
    save: async () => settings
  } as any;
  const service = new LocalFirstWeatherService(integration?.weatherSource, store, async () => {
    providerRequests += 1;
    throw new Error('Open-Meteo current conditions should not be requested while local data is available.');
  });

  const snapshot = await service.current();
  assert.equal(providerRequests, 0);
  assert.equal(snapshot.raw[0]?.provider, 'ecowitt');
  assert.equal(snapshot.sources[0]?.label, 'Back garden');
  assert.equal(snapshot.derived.temperatureC, 20);
});

test('Ecowitt configuration is optional and accepts only a local HTTP host', () => {
  assert.equal(resolveEcowittConfig({}), undefined);
  const config = resolveEcowittConfig({ ECOWITT_HOST: '192.168.0.60', ECOWITT_LOCATION_LABEL: 'Weather mast' });
  assert.equal(config?.endpoint.href, 'http://192.168.0.60/get_livedata_info');
  assert.equal(config?.locationLabel, 'Weather mast');
  assert.throws(() => resolveEcowittConfig({ ECOWITT_HOST: 'https://example.test' }), /local HTTP protocol/);
  assert.throws(() => resolveEcowittConfig({ ECOWITT_HOST: 'http://example.test/private' }), /arbitrary path/);
});
