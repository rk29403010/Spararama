import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WEATHER_SETTINGS, validateWeatherSettings } from '../../server/weather/settings';
import { weatherInfluence } from '../../server/weather/service';

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
