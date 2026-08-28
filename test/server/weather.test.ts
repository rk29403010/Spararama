import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WEATHER_SETTINGS, validateWeatherSettings } from '../../server/weather/settings';
import { WeatherService, weatherInfluence } from '../../server/weather/service';

test('weather settings accept nearest and triangulation modes with a spa location', () => {
  const nearest = validateWeatherSettings({
    ...DEFAULT_WEATHER_SETTINGS,
    location: { latitude: 52.58, longitude: 1.51, label: 'Test spa', source: 'lookup' }
  });
  assert.equal(nearest.samplingMode, 'nearest');
  assert.equal(nearest.location?.label, 'Test spa');

  const triangulated = validateWeatherSettings({ ...nearest, samplingMode: 'triangulate' });
  assert.equal(triangulated.samplingMode, 'triangulate');
  assert.equal(triangulated.triangulationRadiusKm, 12);
});

test('microclimate settings change signal strength without changing raw data', () => {
  const outdoorExposed = weatherInfluence(validateWeatherSettings({
    ...DEFAULT_WEATHER_SETTINGS,
    tweaks: { installation: 'outdoor', windExposure: 'exposed', solarExposure: 'sun-trap', overallInfluencePercent: 100 }
  }));
  const indoorSheltered = weatherInfluence(validateWeatherSettings({
    ...DEFAULT_WEATHER_SETTINGS,
    tweaks: { installation: 'indoor', windExposure: 'sheltered', solarExposure: 'shade', overallInfluencePercent: 100 }
  }));

  assert.ok(outdoorExposed.wind > indoorSheltered.wind);
  assert.ok(outdoorExposed.solar > indoorSheltered.solar);
  assert.ok(outdoorExposed.temperature > indoorSheltered.temperature);
});

test('overall weather influence is bounded', () => {
  assert.throws(() => validateWeatherSettings({ ...DEFAULT_WEATHER_SETTINGS, tweaks: { ...DEFAULT_WEATHER_SETTINGS.tweaks, overallInfluencePercent: 250 } }));
  const off = weatherInfluence(validateWeatherSettings({ ...DEFAULT_WEATHER_SETTINGS, tweaks: { ...DEFAULT_WEATHER_SETTINGS.tweaks, overallInfluencePercent: 0 } }));
  assert.equal(off.temperature, 0);
  assert.equal(off.wind, 0);
  assert.equal(off.solar, 0);
});

test('UK postcode lookup uses Postcodes.io and maps a friendly location', async () => {
  let requestedUrl = '';
  const request: typeof fetch = async input => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      status: 200,
      result: {
        postcode: 'NR13 3SF',
        latitude: 52.59203,
        longitude: 1.517333,
        parish: 'Cantley, Limpenhoe and Southwood',
        admin_county: 'Norfolk',
        country: 'England'
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await new WeatherService(undefined, request).lookup('nr13 3sf');
  assert.equal(requestedUrl, 'https://api.postcodes.io/postcodes/NR133SF');
  assert.deepEqual(result, [{
    id: 'postcode:NR133SF',
    name: 'NR13 3SF',
    admin1: 'Norfolk',
    admin2: 'Cantley, Limpenhoe and Southwood',
    country: 'England',
    postcodes: ['NR13 3SF'],
    latitude: 52.59203,
    longitude: 1.517333,
    timezone: 'Europe/London'
  }]);
});

test('unknown UK postcode returns an empty location list', async () => {
  const request: typeof fetch = async () => new Response(JSON.stringify({ status: 404 }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
  assert.deepEqual(await new WeatherService(undefined, request).lookup('SW1A 9ZZ'), []);
});

test('place lookup continues to use Open-Meteo', async () => {
  let requestedUrl = '';
  const request: typeof fetch = async input => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ results: [{
      id: 2641181,
      name: 'Norwich',
      admin1: 'England',
      admin2: 'Norfolk',
      country: 'United Kingdom',
      latitude: 52.62783,
      longitude: 1.29834,
      timezone: 'Europe/London'
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await new WeatherService(undefined, request).lookup('Norwich');
  assert.match(requestedUrl, /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?/);
  assert.equal(result[0]?.name, 'Norwich');
});
