import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Minus, Plus, RefreshCw, Thermometer, Wifi, WifiOff } from 'lucide-react';
import type { AppState } from '../types';
import { spaApi, type SpaStatusDto } from '../lib/spaApi';
import { ManualLogModal } from './ManualLogModal';

interface HomeProps { state: AppState; }
function finiteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

const CONCERN_AFTER_MS = 60 * 60 * 1000;

function ageText(timestamp: number | undefined, now: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return 'unknown';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function acquiredText(timestamp: number | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return 'No live data acquired yet';
  return `Data acquired ${new Date(timestamp).toLocaleString()}`;
}

function ManualReadingButton({ onClick, label = 'Log temperature manually' }: { onClick: () => void; label?: string }) {
  return <button type="button" onClick={onClick} className="min-h-12 px-5 rounded-xl bg-indigo-600 text-white font-extrabold flex items-center justify-center gap-2"><Thermometer className="w-5 h-5" />{label}</button>;
}

function RefreshButton({ refreshing, acquiredAt, onClick, dark = true, label }: { refreshing: boolean; acquiredAt?: number; onClick: () => void; dark?: boolean; label?: string }) {
  const caption = refreshing ? 'Refreshing' : acquiredText(acquiredAt);
  return <div className="relative group inline-flex">
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      title={caption}
      aria-label={caption}
      className={`${label ? 'min-h-12 px-5 gap-2 rounded-xl' : 'w-11 h-11 rounded-full'} ${dark ? 'bg-white/10 text-white' : 'bg-slate-900 text-white'} disabled:opacity-60 flex items-center justify-center font-extrabold`}
    >
      <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />{label && <span>{refreshing ? 'Refreshing…' : label}</span>}
    </button>
    <span className="pointer-events-none absolute right-0 top-full mt-2 z-20 hidden group-hover:block whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white shadow-lg">
      {caption}
    </span>
  </div>;
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
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showManualLog, setShowManualLog] = useState(false);
  const [now, setNow] = useState(Date.now());
  const refreshInFlight = useRef(false);

  const refresh = async (manual = false) => {
    if (connectivity !== 'wifi' || !liveConnectorAvailable || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (manual) setRefreshing(true);
    if (!status) setLoading(true);
    setError('');
    try {
      const next = await spaApi.status();
      setStatus(next);
      setReachable(Boolean(next.connected));
    } catch (err: any) {
      // Keep the last displayed values. A backend/API hiccup should make the data
      // stale, not erase the last real reading.
      setReachable(false);
      setError(err?.message || 'The hot tub could not be contacted.');
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
      if (manual) setRefreshing(false);
      setNow(Date.now());
    }
  };

  useEffect(() => {
    if (connectivity !== 'wifi' || !liveConnectorAvailable) { setReachable(false); setLoading(false); return; }
    void refresh(false);
    const pollTimer = window.setInterval(() => void refresh(false), 15000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { window.clearInterval(pollTimer); window.clearInterval(clockTimer); };
  }, [connectivity, liveConnectorAvailable]);

  const command = async (name: string, action: () => Promise<SpaStatusDto>) => {
    setBusy(name); setError('');
    try { const next = await action(); setStatus(next); setReachable(Boolean(next.connected)); setNow(Date.now()); }
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

  const hasLastReading = Boolean(status && status.updatedAt > 0 && finiteNumber(status.waterTemperatureC));
  const lastContactAt = status?.lastContactAt || status?.updatedAt;
  const contactAgeMs = lastContactAt ? Math.max(0, now - lastContactAt) : Number.POSITIVE_INFINITY;
  const longOutage = !reachable && contactAgeMs >= CONCERN_AFTER_MS;

  if (!reachable && !hasLastReading) return <>
    <div className="p-4 max-w-xl mx-auto space-y-5"><section className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center gap-3 text-slate-500 mb-4"><WifiOff className="w-6 h-6" /><span className="font-extrabold uppercase tracking-widest text-xs">Remote tub - not connected yet</span></div>
      <h2 className="text-3xl font-black text-slate-900">{waterBody.name}</h2>
      <p className="mt-3 text-slate-600">{loading ? 'Checking the hot tub…' : 'Spararama has not obtained a live reading yet. It will keep trying automatically; manual logging remains available.'}</p>
      {error && <p className="mt-3 text-sm text-slate-700 bg-slate-100 rounded-xl p-3">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-3"><RefreshButton refreshing={refreshing} acquiredAt={status?.updatedAt} onClick={() => void refresh(true)} dark={false} label="Try again" /><ManualReadingButton onClick={() => setShowManualLog(true)} /></div>
    </section></div>{manualModal}
  </>;

  const current = finiteNumber(status?.waterTemperatureC) ? status.waterTemperatureC : null;
  const statusTarget = finiteNumber(status?.targetTemperatureC) ? status.targetTemperatureC : null;
  const fallbackTarget = finiteNumber(state.config.defaultHeatingTarget) ? state.config.defaultHeatingTarget : 40;
  const target = statusTarget ?? fallbackTarget;
  const disabled = !status || !reachable || busy !== null;
  const dataAge = ageText(status?.updatedAt, now);
  const contactAge = ageText(lastContactAt, now);
  const setTarget = (value: number) => { const max = state.config.maxTemp || 40; void command('target', () => spaApi.setTargetTemperature(Math.max(5, Math.min(max, value)))); };

  return <>
    <div className="p-4 max-w-xl mx-auto space-y-5">
      <section className="rounded-3xl bg-slate-900 text-white p-6 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <div className={`flex items-center gap-2 ${reachable ? 'text-emerald-300' : longOutage ? 'text-amber-300' : 'text-slate-300'}`}>
            {reachable ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            <span className="font-extrabold uppercase tracking-widest text-xs">
              {reachable ? `Live - ${status?.transport || 'connected'}` : longOutage ? `Remote data stale - ${contactAge}` : `Connection interrupted - ${contactAge}`}
            </span>
          </div>
          <RefreshButton refreshing={refreshing} acquiredAt={status?.updatedAt} onClick={() => void refresh(true)} />
        </div>
        <h2 className="text-xl font-extrabold mt-3">{waterBody.name}</h2>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div><p className="text-xs uppercase tracking-widest text-slate-400 font-bold">{reachable ? 'Water now' : 'Last water'}</p><p className="text-6xl font-black tabular-nums mt-1">{current === null ? '—' : `${Math.round(current)}°`}</p></div>
          <div><p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Target</p><p className="text-6xl font-black tabular-nums mt-1">{target.toFixed(0)}°</p></div>
        </div>
        {!reachable && !longOutage && <p className="mt-4 text-sm text-slate-300">Wi-Fi contact dropped out. Showing the last reading from {dataAge}; Spararama is retrying automatically and remote controls are paused.</p>}
        {!reachable && longOutage && <div className="mt-4 rounded-xl bg-amber-400/10 border border-amber-300/20 p-3 text-sm text-amber-100 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" /><span>The spa has not been contacted successfully for {contactAge}. The displayed temperature may now be significantly out of date. Spararama will continue trying automatically.</span></div>}
        {current === null && <p className="mt-3 text-sm text-amber-200">The tub did not return a usable water-temperature reading.</p>}
      </section>

      <section className="rounded-3xl bg-white border border-slate-200 p-5 shadow-sm"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-widest text-slate-400">Target temperature</p><p className="text-3xl font-black text-slate-900 mt-1">{target.toFixed(0)}°C</p></div><div className="flex items-center gap-2"><button type="button" disabled={disabled} onClick={() => setTarget(target - 1)} className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center disabled:opacity-40" aria-label="Lower target temperature"><Minus className="w-6 h-6" /></button><button type="button" disabled={disabled} onClick={() => setTarget(target + 1)} className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center disabled:opacity-40" aria-label="Raise target temperature"><Plus className="w-6 h-6" /></button></div></div></section>

      <section className="space-y-3">
        {!reachable && <p className="text-xs font-semibold text-slate-500 px-1">Last known equipment state - controls paused until contact returns.</p>}
        <ControlSwitch label="Filter" on={Boolean(status?.filterOn)} busy={busy === 'filter'} disabled={disabled} onToggle={() => status && void command('filter', () => spaApi.setFilter(!status.filterOn))} />
        <ControlSwitch label="Heater" on={Boolean(status?.heaterOn)} busy={busy === 'heater'} disabled={disabled} onToggle={() => status && void command('heater', () => spaApi.setHeater(!status.heaterOn))} />
        <ControlSwitch label="Bubbles" on={Boolean(status?.bubblesOn)} busy={busy === 'bubbles'} disabled={disabled} onToggle={() => status && void command('bubbles', () => spaApi.setBubbles(!status.bubblesOn))} />
      </section>

      <section className="rounded-2xl bg-slate-100 p-4"><p className="text-sm text-slate-600 mb-3">You can always add a manual reading if the displayed sensor value looks wrong or you need to record something the controller cannot see.</p><ManualReadingButton onClick={() => setShowManualLog(true)} label="Add manual observation" /></section>
      {error && <div className={`rounded-2xl p-4 text-sm font-semibold ${longOutage ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{error}</div>}
    </div>{manualModal}
  </>;
}