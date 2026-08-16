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

  const save = async (next: WeatherSettingsDto, success = 'Weather settings saved.') => {
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
      setMessage('This browser does not provide phone/device location.');
      return;
    }
    setBusy('location');
    setMessage('Requesting device location…');
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
        }, 'Spa location set from this device.');
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
    }, `Spa location set to ${result.name}.`);
    setResults([]);
    setQuery('');
  };

  if (!config) {
    return <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"><h3 className="text-lg font-extrabold text-slate-900">Weather</h3><p className="text-sm text-slate-500 mt-2">{message || 'Loading weather settings…'}</p></section>;
  }

  const locationText = config.location?.label || (config.location ? `${config.location.latitude.toFixed(4)}, ${config.location.longitude.toFixed(4)}` : 'Not set');

  return (
    <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-5">
      <div>
        <h3 className="text-lg font-extrabold text-slate-900">Weather & location</h3>
        <p className="text-xs text-slate-500 mt-1">Used for temperature fallback, weather telemetry and heating estimates.</p>
      </div>

      <div className="rounded-xl bg-slate-50 p-4 flex items-start gap-3">
        <MapPin className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
        <div><div className="text-xs uppercase tracking-wider font-bold text-slate-400">Spa location</div><div className="font-bold text-slate-800 mt-1">{locationText}</div>{config.location && <div className="text-xs text-slate-500 mt-1">{config.location.latitude.toFixed(5)}, {config.location.longitude.toFixed(5)}</div>}</div>
      </div>

      <button type="button" disabled={Boolean(busy)} onClick={usePhoneLocation} className="w-full min-h-12 rounded-xl bg-indigo-600 text-white font-extrabold flex items-center justify-center gap-2 disabled:opacity-50"><LocateFixed className="w-5 h-5" />Use this phone/device location</button>

      <div className="space-y-2">
        <div className="text-sm font-bold text-slate-700">Or look up a place / postcode</div>
        <div className="flex gap-2">
          <input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search(); }} placeholder="e.g. NR13 3SF or Cantley" className="min-w-0 flex-1 bg-slate-100 rounded-xl px-3 py-3 font-semibold" />
          <button type="button" disabled={busy === 'lookup' || query.trim().length < 2} onClick={() => void search()} className="w-12 rounded-xl bg-slate-900 text-white flex items-center justify-center disabled:opacity-50"><Search className="w-5 h-5" /></button>
        </div>
        {results.length > 0 && <div className="border border-slate-200 rounded-xl overflow-hidden">{results.map(result => <button type="button" key={result.id} onClick={() => chooseResult(result)} className="w-full text-left px-4 py-3 border-b last:border-b-0 border-slate-100 hover:bg-slate-50"><div className="font-bold text-slate-800">{result.name}</div><div className="text-xs text-slate-500">{[result.admin2, result.admin1, result.country].filter(Boolean).join(', ')}</div></button>)}</div>}
      </div>

      <div>
        <div className="text-sm font-bold text-slate-700 mb-2">Weather sampling</div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void save({ ...config, samplingMode: 'nearest' })} className={`py-3 rounded-xl font-bold ${config.samplingMode === 'nearest' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Nearest</button>
          <button type="button" onClick={() => void save({ ...config, samplingMode: 'triangulate' })} className={`py-3 rounded-xl font-bold ${config.samplingMode === 'triangulate' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Triangulate ×3</button>
        </div>
        <p className="text-xs text-slate-500 mt-2">Triangulation retains all three source readings and currently uses their simple mean for the calculated value.</p>
      </div>

      <div className="space-y-4 border-t border-slate-100 pt-5">
        <div><div className="font-extrabold text-slate-900">Local weather tweaks</div><p className="text-xs text-slate-500 mt-1">These change how strongly external conditions affect heating calculations; raw weather is always retained unchanged.</p></div>

        <label className="block"><span className="text-sm font-bold text-slate-700">Spa environment</span><select value={config.tweaks.installation} onChange={event => void save({ ...config, tweaks: { ...config.tweaks, installation: event.target.value as 'indoor' | 'outdoor' } })} className="mt-1 w-full bg-slate-100 rounded-xl px-3 py-3 font-semibold"><option value="outdoor">Outdoor</option><option value="indoor">Indoor / enclosed</option></select></label>

        <label className="block"><span className="text-sm font-bold text-slate-700">Wind exposure</span><select value={config.tweaks.windExposure} onChange={event => void save({ ...config, tweaks: { ...config.tweaks, windExposure: event.target.value as 'sheltered' | 'normal' | 'exposed' } })} className="mt-1 w-full bg-slate-100 rounded-xl px-3 py-3 font-semibold"><option value="sheltered">Sheltered</option><option value="normal">Normal</option><option value="exposed">Exposed</option></select></label>

        <label className="block"><span className="text-sm font-bold text-slate-700">Sun exposure</span><select value={config.tweaks.solarExposure} onChange={event => void save({ ...config, tweaks: { ...config.tweaks, solarExposure: event.target.value as 'shade' | 'mixed' | 'sun-trap' } })} className="mt-1 w-full bg-slate-100 rounded-xl px-3 py-3 font-semibold"><option value="shade">Mostly shade</option><option value="mixed">Mixed sun / shade</option><option value="sun-trap">Sun trap / full sun</option></select></label>

        <label className="block"><div className="flex justify-between gap-3"><span className="text-sm font-bold text-slate-700">Overall weather influence</span><span className="text-sm font-extrabold text-indigo-600">{config.tweaks.overallInfluencePercent}%</span></div><input type="range" min="0" max="200" step="10" value={config.tweaks.overallInfluencePercent} onChange={event => setConfig({ ...config, tweaks: { ...config.tweaks, overallInfluencePercent: Number(event.target.value) } })} onPointerUp={() => void save(config)} onKeyUp={() => void save(config)} className="w-full mt-2" /><div className="flex justify-between text-[10px] uppercase font-bold tracking-wider text-slate-400"><span>Ignore</span><span>Normal</span><span>Strong</span></div></label>
      </div>

      <p className="text-[11px] text-slate-400">Current default provider is Open-Meteo model data. The stored source-location format is provider-neutral so observed weather-station providers can be added later without losing the raw/derived distinction.</p>
      {message && <p className="text-xs font-semibold text-slate-600 bg-slate-50 rounded-xl p-3">{message}</p>}
    </section>
  );
}
