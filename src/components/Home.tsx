import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Minus, Plus, RefreshCw, Thermometer, Wifi, WifiOff } from 'lucide-react';
import type { AppState } from '../types';
import { spaApi, type SpaStatusDto } from '../lib/spaApi';
import { ManualLogModal } from './ManualLogModal';

interface HomeProps { state: AppState; }
function finiteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

function ManualReadingButton({ onClick, label = 'Log temperature manually' }: { onClick: () => void; label?: string }) {
  return <button type="button" onClick={onClick} className="min-h-12 px-5 rounded-xl bg-indigo-600 text-white font-extrabold flex items-center justify-center gap-2"><Thermometer className="w-5 h-5" />{label}</button>;
}

function ControlSwitch({ label, on, disabled, busy, onToggle }: { label: string; on: boolean; disabled: boolean; busy: boolean; onToggle: () => void; }) {
  return <button type="button" disabled={disabled} onClick={onToggle} className="flex items-center justify-between gap-4 w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 disabled:opacity-50">
    <span className="text-lg font-extrabold text-slate-800">{label}</span>
    <span className={`relative w-14 h-8 rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-slate-300'}`}><span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-7' : 'translate-x-1'}`} /></span>
    <span className="sr-only">{busy ? 'Updating' : on ? 'On' : 'Off'}</span>
  </button>;
}

export function Home({ state }: HomeProps) {
  const waterBody = useMemo(() => state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) ?? state.domain.waterBodies[0], [state.domain.waterBodies, state.domain.activeWaterBodyId]);
  const connectivity = waterBody?.connectivity ?? 'wifi';
  const liveConnectorAvailable = waterBody?.connectorId === 'cleverspa';
  const [status, setStatus] = useState<SpaStatusDto | null>(null);
  const [reachable, setReachable] = useState(false);
  const [loading, setLoading] = useState(connectivity === 'wifi' && liveConnectorAvailable);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showManualLog, setShowManualLog] = useState(false);

  const refresh = async () => {
    if (connectivity !== 'wifi' || !liveConnectorAvailable) return;
    setLoading(true); setError('');
    try { const next = await spaApi.status(); setStatus(next); setReachable(Boolean(next.connected)); }
    catch (err: any) { setReachable(false); setError(err?.message || 'The hot tub could not be contacted.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (connectivity !== 'wifi' || !liveConnectorAvailable) { setReachable(false); setLoading(false); return; }
    void refresh(); const timer = window.setInterval(() => void refresh(), 15000); return () => window.clearInterval(timer);
  }, [connectivity, liveConnectorAvailable]);

  const command = async (name: string, action: () => Promise<SpaStatusDto>) => {
    setBusy(name); setError('');
    try { const next = await action(); setStatus(next); setReachable(Boolean(next.connected)); }
    catch (err: any) { setReachable(false); setError(err?.message || 'The command could not be sent to the hot tub.'); }
    finally { setBusy(null); }
  };

  if (!waterBody) return null;
  const manualModal = showManualLog ? <ManualLogModal state={state} onClose={() => setShowManualLog(false)} /> : null;

  if (connectivity === 'none') return <>
    <div className="p-4 max-w-xl mx-auto space-y-5"><section className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center gap-3 text-slate-500 mb-4"><WifiOff className="w-6 h-6" /><span className="font-extrabold uppercase tracking-widest text-xs">Manual monitoring</span></div>
      <h2 className="text-3xl font-black text-slate-900">{waterBody.name}</h2>
      <p className="mt-3 text-slate-600">This water body has no remote hardware connection. Spararama still works: record temperature and equipment state manually, and use chemistry, maintenance and history normally.</p>
      <div className="mt-5"><ManualReadingButton onClick={() => setShowManualLog(true)} /></div>
    </section></div>{manualModal}
  </>;

  if (!liveConnectorAvailable) return <>
    <div className="p-4 max-w-xl mx-auto space-y-5"><section className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center gap-3 text-indigo-700 mb-4"><Wifi className="w-6 h-6" /><span className="font-extrabold uppercase tracking-widest text-xs">Wi-Fi capable</span></div>
      <h2 className="text-3xl font-black text-slate-900">{waterBody.name}</h2>
      <p className="mt-3 text-slate-600">The manufacturer offers Wi-Fi for this model, but Spararama does not yet have a connector for it. Live controls are therefore disabled rather than showing data from the wrong spa.</p>
      <div className="mt-5"><ManualReadingButton onClick={() => setShowManualLog(true)} /></div>
    </section></div>{manualModal}
  </>;

  if (!reachable) return <>
    <div className="p-4 max-w-xl mx-auto space-y-5"><section className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center gap-3 text-amber-700 mb-4"><AlertTriangle className="w-6 h-6" /><span className="font-extrabold uppercase tracking-widest text-xs">Remote tub - currently unreachable</span></div>
      <h2 className="text-3xl font-black text-slate-900">{waterBody.name}</h2>
      <p className="mt-3 text-slate-600">{loading ? 'Checking the hot tub…' : 'Spararama cannot currently contact the tub. Live controls are disabled, but you can continue recording observations manually.'}</p>
      {error && <p className="mt-3 text-sm text-amber-800 bg-amber-50 rounded-xl p-3">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => void refresh()} className="min-h-12 px-5 rounded-xl bg-slate-900 text-white font-extrabold flex items-center gap-2"><RefreshCw className="w-5 h-5" />Try again</button><ManualReadingButton onClick={() => setShowManualLog(true)} /></div>
    </section></div>{manualModal}
  </>;

  const current = finiteNumber(status?.waterTemperatureC) ? status.waterTemperatureC : null;
  const statusTarget = finiteNumber(status?.targetTemperatureC) ? status.targetTemperatureC : null;
  const fallbackTarget = finiteNumber(state.config.defaultHeatingTarget) ? state.config.defaultHeatingTarget : 40;
  const target = statusTarget ?? fallbackTarget;
  const disabled = !status || busy !== null;
  const setTarget = (value: number) => { const max = state.config.maxTemp || 40; void command('target', () => spaApi.setTargetTemperature(Math.max(5, Math.min(max, value)))); };

  return <>
    <div className="p-4 max-w-xl mx-auto space-y-5">
      <section className="rounded-3xl bg-slate-900 text-white p-6 shadow-lg">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-emerald-300"><Wifi className="w-5 h-5" /><span className="font-extrabold uppercase tracking-widest text-xs">Live - {status?.transport || 'connected'}</span></div><button type="button" onClick={() => void refresh()} className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center" aria-label="Refresh"><RefreshCw className="w-5 h-5" /></button></div>
        <h2 className="text-xl font-extrabold mt-3">{waterBody.name}</h2>
        <div className="mt-5 grid grid-cols-2 gap-4"><div><p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Water now</p><p className="text-6xl font-black tabular-nums mt-1">{current === null ? '—' : `${current.toFixed(1)}°`}</p></div><div><p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Target</p><p className="text-6xl font-black tabular-nums mt-1">{target.toFixed(0)}°</p></div></div>
        {current === null && <p className="mt-3 text-sm text-amber-200">The tub is connected, but it did not return a usable water-temperature reading.</p>}
      </section>
      <section className="rounded-3xl bg-white border border-slate-200 p-5 shadow-sm"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-widest text-slate-400">Target temperature</p><p className="text-3xl font-black text-slate-900 mt-1">{target.toFixed(0)}°C</p></div><div className="flex items-center gap-2"><button type="button" disabled={disabled} onClick={() => setTarget(target - 1)} className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center disabled:opacity-40" aria-label="Lower target temperature"><Minus className="w-6 h-6" /></button><button type="button" disabled={disabled} onClick={() => setTarget(target + 1)} className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center disabled:opacity-40" aria-label="Raise target temperature"><Plus className="w-6 h-6" /></button></div></div></section>
      <section className="space-y-3"><ControlSwitch label="Filter" on={Boolean(status?.filterOn)} busy={busy === 'filter'} disabled={disabled} onToggle={() => status && void command('filter', () => spaApi.setFilter(!status.filterOn))} /><ControlSwitch label="Heater" on={Boolean(status?.heaterOn)} busy={busy === 'heater'} disabled={disabled} onToggle={() => status && void command('heater', () => spaApi.setHeater(!status.heaterOn))} /><ControlSwitch label="Bubbles" on={Boolean(status?.bubblesOn)} busy={busy === 'bubbles'} disabled={disabled} onToggle={() => status && void command('bubbles', () => spaApi.setBubbles(!status.bubblesOn))} /></section>
      <section className="rounded-2xl bg-slate-100 p-4"><p className="text-sm text-slate-600 mb-3">You can always add a manual reading if the displayed sensor value looks wrong or you need to record something the controller cannot see.</p><ManualReadingButton onClick={() => setShowManualLog(true)} label="Add manual observation" /></section>
      {error && <div className="rounded-2xl bg-amber-50 text-amber-900 p-4 text-sm font-semibold">{error}</div>}
    </div>{manualModal}
  </>;
}
