import React, { useEffect, useState } from 'react';
import { LocateFixed, MapPin, Search } from 'lucide-react';
import { weatherApi, type WeatherLookupResultDto, type WeatherSettingsDto } from '../lib/weatherApi';

export function WeatherConfiguration() {
  const [config, setConfig] = useState<WeatherSettingsDto | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WeatherLookupResultDto[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    weatherApi.config().then(setConfig).catch((error: any) => setMessage(error?.message || 'Unable to load weather settings.'));
  }, []);

  const save = async (next: WeatherSettingsDto, success = 'Saved') => {
    setConfig(next);
    setBusy('save');
    setMessage('');
    try {
      setConfig(await weatherApi.saveConfig(next));
      setMessage(success);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to save weather settings.');
    } finally {
      setBusy('');
    }
  };

  const usePhoneLocation = () => {
    if (!config) return;
    if (!navigator.geolocation) {
      setMessage('Device location is unavailable in this browser.');
      return;
    }
    setBusy('location');
    setMessage('Getting location…');
    navigator.geolocation.getCurrentPosition(
      position => {
        void save({
          ...config,
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            label: 'Device location',
            source: 'phone'
          }
        }, 'Location updated');
      },
      error => {
        setBusy('');
        setMessage(error.message || 'Unable to read device location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
    );
  };

  const search = async () => {
    const term = query.trim();
    if (term.length < 2) return;
    setBusy('lookup');
    setMessage('');
    try {
      setResults(await weatherApi.lookup(term));
    } catch (error: any) {
      setMessage(error?.message || 'Location lookup failed.');
    } finally {
      setBusy('');
    }
  };

  const chooseResult = (result: WeatherLookupResultDto) => {
    if (!config) return;
    const context = [result.admin2, result.admin1, result.country].filter(Boolean).join(', ');
    void save({
      ...config,
      location: {
        latitude: result.latitude,
        longitude: result.longitude,
        label: context ? `${result.name}, ${context}` : result.name,
        source: 'lookup'
      }
    }, 'Location updated');
    setResults([]);
    setQuery('');
  };

  if (!config) {
    return (
      <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200">
        <h3 className="text-xl font-black text-slate-950">Weather & location</h3>
        <p role="status" className="text-base font-bold text-slate-600 mt-2">{message || 'Loading…'}</p>
      </section>
    );
  }

  const locationText = config.location?.label || (config.location ? `${config.location.latitude.toFixed(4)}, ${config.location.longitude.toFixed(4)}` : 'Not set');

  return (
    <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-5">
      <h3 className="text-xl font-black text-slate-950">Weather & location</h3>

      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex items-center gap-3">
        <MapPin className="w-6 h-6 text-indigo-700 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-500">Spa location</div>
          <div className="text-lg font-black text-slate-950 break-words">{locationText}</div>
        </div>
      </div>

      <button type="button" disabled={Boolean(busy)} onClick={usePhoneLocation} className="w-full min-h-14 rounded-xl bg-indigo-700 text-white text-base font-black flex items-center justify-center gap-2 disabled:opacity-50">
        <LocateFixed className="w-5 h-5" aria-hidden="true" />Use device location
      </button>

      <div className="space-y-2">
        <label htmlFor="weather-location-search" className="text-base font-black text-slate-800">Place or postcode</label>
        <div className="flex gap-2">
          <input
            id="weather-location-search"
            name="weather-location-search"
            autoComplete="off"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void search(); }}
            placeholder="NR13 3SF…"
            className="min-w-0 flex-1 min-h-14 bg-slate-100 text-slate-950 rounded-xl px-3 font-bold"
          />
          <button type="button" aria-label="Search locations" disabled={busy === 'lookup' || query.trim().length < 2} onClick={() => void search()} className="w-14 h-14 shrink-0 rounded-xl bg-slate-950 text-white flex items-center justify-center disabled:opacity-50">
            <Search className="w-6 h-6" aria-hidden="true" />
          </button>
        </div>
        {results.length > 0 && (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            {results.map(result => (
              <button type="button" key={result.id} onClick={() => chooseResult(result)} className="w-full min-h-14 text-left px-4 py-3 border-b last:border-b-0 border-slate-100 hover:bg-slate-50">
                <div className="font-black text-slate-950">{result.name}</div>
                <div className="text-sm font-bold text-slate-500">{[result.admin2, result.admin1, result.country].filter(Boolean).join(', ')}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <details className="border-t border-slate-200 pt-4">
        <summary className="min-h-12 cursor-pointer flex items-center text-base font-black text-slate-800">Advanced weather settings</summary>
        <div className="space-y-5 pt-3">
          <div>
            <div className="text-base font-black text-slate-800 mb-2">Sampling</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={config.samplingMode === 'nearest'} onClick={() => void save({ ...config, samplingMode: 'nearest' })} className={`min-h-14 rounded-xl font-black ${config.samplingMode === 'nearest' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700'}`}>Nearest</button>
              <button type="button" aria-pressed={config.samplingMode === 'triangulate'} onClick={() => void save({ ...config, samplingMode: 'triangulate' })} className={`min-h-14 rounded-xl font-black ${config.samplingMode === 'triangulate' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-700'}`}>3-source mean</button>
            </div>
          </div>

          <label className="block"><span className="text-base font-black text-slate-800">Spa environment</span><select value={config.tweaks.installation} onChange={event => void save({ ...config, tweaks: { ...config.tweaks, installation: event.target.value as 'indoor' | 'outdoor' } })} className="mt-1 w-full min-h-14 bg-slate-100 text-slate-950 rounded-xl px-3 font-bold"><option value="outdoor">Outdoor</option><option value="indoor">Indoor / enclosed</option></select></label>

          <label className="block"><span className="text-base font-black text-slate-800">Wind exposure</span><select value={config.tweaks.windExposure} onChange={event => void save({ ...config, tweaks: { ...config.tweaks, windExposure: event.target.value as 'sheltered' | 'normal' | 'exposed' } })} className="mt-1 w-full min-h-14 bg-slate-100 text-slate-950 rounded-xl px-3 font-bold"><option value="sheltered">Sheltered</option><option value="normal">Normal</option><option value="exposed">Exposed</option></select></label>

          <label className="block"><span className="text-base font-black text-slate-800">Sun exposure</span><select value={config.tweaks.solarExposure} onChange={event => void save({ ...config, tweaks: { ...config.tweaks, solarExposure: event.target.value as 'shade' | 'mixed' | 'sun-trap' } })} className="mt-1 w-full min-h-14 bg-slate-100 text-slate-950 rounded-xl px-3 font-bold"><option value="shade">Mostly shade</option><option value="mixed">Mixed sun / shade</option><option value="sun-trap">Full sun</option></select></label>

          <label className="block">
            <div className="flex justify-between gap-3"><span className="text-base font-black text-slate-800">Weather influence</span><span className="text-lg font-black tabular-nums text-indigo-800">{config.tweaks.overallInfluencePercent}%</span></div>
            <input type="range" min="0" max="200" step="10" value={config.tweaks.overallInfluencePercent} onChange={event => setConfig({ ...config, tweaks: { ...config.tweaks, overallInfluencePercent: Number(event.target.value) } })} onPointerUp={() => void save(config)} onKeyUp={() => void save(config)} className="w-full mt-3" />
            <div className="flex justify-between text-xs font-bold text-slate-500"><span>Ignore</span><span>Normal</span><span>Strong</span></div>
          </label>

          <details className="rounded-xl bg-slate-50 px-3">
            <summary className="min-h-11 cursor-pointer text-sm font-bold text-slate-600">Technical details</summary>
            <div className="pb-3 text-sm text-slate-600 space-y-2">
              {config.location && <p>{config.location.latitude.toFixed(5)}, {config.location.longitude.toFixed(5)}</p>}
              <p>Weather provider: Open-Meteo model data.</p>
              <p>Three-source sampling stores all source readings and uses their mean for the derived value.</p>
            </div>
          </details>
        </div>
      </details>

      {message && <p role="status" className="text-sm font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3">{message}</p>}
    </section>
  );
}
