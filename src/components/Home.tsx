import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Flame, Loader2, Minus, Plus, RefreshCw, Thermometer, Waves, Wifi, WifiOff, Wind } from 'lucide-react';
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
  return (
    <button type="button" onClick={onClick} className="min-h-12 px-5 rounded-xl bg-indigo-600 text-white font-extrabold flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] transition-transform">
      <Thermometer className="w-5 h-5" />{label}
    </button>
  );
}

function RefreshButton({ refreshing, acquiredAt, onClick, dark = true, label }: { refreshing: boolean; acquiredAt?: number; onClick: () => void; dark?: boolean; label?: string }) {
  const caption = refreshing ? 'Refreshing' : acquiredText(acquiredAt);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      title={caption}
      aria-label={label ? `${label}. ${caption}` : caption}
      className={`${label ? 'min-h-12 px-5 gap-2 rounded-xl' : 'w-11 h-11 rounded-xl'} ${dark ? 'bg-white/10 text-white' : 'bg-slate-900 text-white'} disabled:opacity-60 flex items-center justify-center font-extrabold active:scale-[0.98] transition-transform`}
    >
      <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />{label && <span>{refreshing ? 'Refreshing…' : label}</span>}
    </button>
  );
}

function EquipmentButton({ label, icon, on, disabled, busy, onToggle }: { label: string; icon: React.ReactNode; on: boolean; disabled: boolean; busy: boolean; onToggle: () => void; }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onToggle}
      className={`min-h-24 rounded-2xl border-2 px-3 py-4 flex flex-col items-center justify-center gap-2 text-center transition-colors disabled:opacity-45 ${on ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-800'}`}
    >
      {busy ? <Loader2 className="w-7 h-7 animate-spin" /> : icon}
      <span className="font-black leading-tight">{label}</span>
      <span className={`text-xs font-extrabold ${on ? 'text-indigo-100' : 'text-slate-500'}`}>{busy ? 'Updating…' : on ? 'On' : 'Off'}</span>
    </button>
  );
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
    setBusy(name);
    setError('');
    try {
      const next = await action();
      setStatus(next);
      setReachable(Boolean(next.connected));
      setNow(Date.now());
    } catch (err: any) {
      setReachable(false);
      setError(err?.message || 'The command could not be sent to the hot tub.');
    } finally {
      setBusy(null);
    }
  };

  if (!waterBody) return null;
  const manualModal = showManualLog ? <ManualLogModal state={state} onClose={() => setShowManualLog(false)} /> : null;

  if (connectivity === 'none') return <>
    <div className="p-4 max-w-xl mx-auto space-y-5"><section className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center gap-3 text-slate-600 mb-4"><WifiOff className="w-6 h-6" /><span className="font-extrabold uppercase tracking-widest text-xs">Manual monitoring</span></div>
      <h2 className="text-3xl font-black text-slate-950">{waterBody.name}</h2>
      <p className="mt-3 text-slate-600">This water body has no remote hardware connection. Spararama still works: record temperature and equipment state manually, and use water care, maintenance and history normally.</p>
      <div className="mt-5"><ManualReadingButton onClick={() => setShowManualLog(true)} /></div>
    </section></div>{manualModal}
  </>;

  if (!liveConnectorAvailable) return <>
    <div className="p-4 max-w-xl mx-auto space-y-5"><section className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center gap-3 text-indigo-700 mb-4"><Wifi className="w-6 h-6" /><span className="font-extrabold uppercase tracking-widest text-xs">Wi-Fi capable</span></div>
      <h2 className="text-3xl font-black text-slate-950">{waterBody.name}</h2>
      <p className="mt-3 text-slate-600">The manufacturer offers Wi-Fi for this model, but Spararama does not yet have a connector for it. Live controls are disabled rather than showing data from the wrong spa.</p>
      <div className="mt-5"><ManualReadingButton onClick={() => setShowManualLog(true)} /></div>
    </section></div>{manualModal}
  </>;

  const hasLastReading = Boolean(status && status.updatedAt > 0 && finiteNumber(status.waterTemperatureC));
  const lastContactAt = status?.lastContactAt || status?.updatedAt;
  const contactAgeMs = lastContactAt ? Math.max(0, now - lastContactAt) : Number.POSITIVE_INFINITY;
  const longOutage = !reachable && contactAgeMs >= CONCERN_AFTER_MS;

  if (!reachable && !hasLastReading) return <>
    <div className="p-4 max-w-xl mx-auto space-y-5"><section className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center gap-3 text-slate-600 mb-4"><WifiOff className="w-6 h-6" /><span className="font-extrabold uppercase tracking-widest text-xs">Remote tub - not connected yet</span></div>
      <h2 className="text-3xl font-black text-slate-950">{waterBody.name}</h2>
      <p className="mt-3 text-slate-600">{loading ? 'Checking the hot tub…' : 'Spararama has not obtained a live reading yet. It will keep trying automatically; manual logging remains available.'}</p>
      {error && <p className="mt-3 text-sm text-slate-800 bg-slate-100 rounded-xl p-3">{error}</p>}
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
  const setTarget = (value: number) => {
    const max = state.config.maxTemp || 40;
    void command('target', () => spaApi.setTargetTemperature(Math.max(5, Math.min(max, value))));
  };

  return <>
    <div className="p-4 max-w-xl mx-auto space-y-5">
      <section className="rounded-3xl bg-slate-950 text-white p-5 sm:p-6 shadow-lg overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`flex items-center gap-2 ${reachable ? 'text-emerald-300' : longOutage ? 'text-amber-300' : 'text-slate-300'}`}>
              {reachable ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
              <span className="font-extrabold uppercase tracking-widest text-xs">
                {reachable ? `Live - ${status?.transport || 'connected'}` : longOutage ? `Data stale - ${contactAge}` : `Connection interrupted - ${contactAge}`}
              </span>
            </div>
            <h2 className="text-lg font-extrabold mt-2 text-white">{waterBody.name}</h2>
          </div>
          <RefreshButton refreshing={refreshing} acquiredAt={status?.updatedAt} onClick={() => void refresh(true)} />
        </div>

        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">{reachable ? 'Water now' : 'Last water'}</p>
            <p className="text-6xl font-black tabular-nums tracking-tight mt-1">{current === null ? '—' : `${Math.round(current)}°`}</p>
          </div>
          <div className="h-14 w-px bg-white/10 mb-1" />
          <div className="text-right">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Target</p>
            <p className="text-4xl font-black tabular-nums tracking-tight mt-1">{target.toFixed(0)}°</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-white/8 border border-white/10 p-2">
          <span className="pl-2 text-sm font-bold text-slate-300">Set target</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={disabled} onClick={() => setTarget(target - 1)} className="w-12 h-12 rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center disabled:opacity-40" aria-label="Lower target temperature"><Minus className="w-6 h-6" /></button>
            <span className="min-w-14 text-center text-2xl font-black tabular-nums">{target.toFixed(0)}°</span>
            <button type="button" disabled={disabled} onClick={() => setTarget(target + 1)} className="w-12 h-12 rounded-xl bg-indigo-500 text-white flex items-center justify-center disabled:opacity-40" aria-label="Raise target temperature"><Plus className="w-6 h-6" /></button>
          </div>
        </div>

        {!reachable && !longOutage && <p className="mt-4 text-sm text-slate-300">Wi-Fi contact dropped out. Showing the last reading from {dataAge}; Spararama is retrying automatically and remote controls are paused.</p>}
        {!reachable && longOutage && <div className="mt-4 rounded-xl bg-amber-400/10 border border-amber-300/20 p-3 text-sm text-amber-100 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" /><span>The spa has not been contacted successfully for {contactAge}. The displayed temperature may now be significantly out of date. Spararama will continue trying automatically.</span></div>}
        {current === null && <p className="mt-3 text-sm text-amber-200">The tub did not return a usable water-temperature reading.</p>}
      </section>

      <section>
        <div className="flex items-end justify-between gap-3 mb-3 px-1">
          <div><p className="text-xs font-black uppercase tracking-widest text-slate-400">Spa controls</p><h3 className="text-xl font-black text-slate-950 mt-0.5">Equipment</h3></div>
          {!reachable && <span className="text-xs font-bold text-amber-800">Last known state</span>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <EquipmentButton label="Filter" icon={<Waves className="w-7 h-7" />} on={Boolean(status?.filterOn)} busy={busy === 'filter'} disabled={disabled} onToggle={() => status && void command('filter', () => spaApi.setFilter(!status.filterOn))} />
          <EquipmentButton label="Heater" icon={<Flame className="w-7 h-7" />} on={Boolean(status?.heaterOn)} busy={busy === 'heater'} disabled={disabled} onToggle={() => status && void command('heater', () => spaApi.setHeater(!status.heaterOn))} />
          <EquipmentButton label="Bubbles" icon={<Wind className="w-7 h-7" />} on={Boolean(status?.bubblesOn)} busy={busy === 'bubbles'} disabled={disabled} onToggle={() => status && void command('bubbles', () => spaApi.setBubbles(!status.bubblesOn))} />
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3 shadow-sm">
        <p className="text-sm text-slate-600 flex-1">Sensor look wrong, or need to record something the controller cannot see?</p>
        <ManualReadingButton onClick={() => setShowManualLog(true)} label="Add observation" />
      </section>

      {error && <div className={`rounded-2xl p-4 text-sm font-semibold ${longOutage ? 'bg-amber-50 text-amber-950 border border-amber-200' : 'bg-white text-slate-700 border border-slate-200'}`}>{error}</div>}
    </div>{manualModal}
  </>;
}
