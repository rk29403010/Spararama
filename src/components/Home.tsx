import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Loader2, Minus, Plus, RefreshCw, Thermometer, Waves, Wifi, WifiOff, Wind } from 'lucide-react';
import type { AppState } from '../types';
import { spaApi, type SpaStatusDto } from '../lib/spaApi';
import { cacheConnectedSpaStatus, readCachedSpaStatus } from '../lib/spaSnapshotCache';
import { ManualLogModal } from './ManualLogModal';

interface HomeProps { state: AppState; }
function finiteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

const BUBBLE_AUTO_RESTART_KEY = 'spararama:bubbles:auto-restart';

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
  return `${Math.floor(hours / 24)}d ago`;
}

function countdownText(endsAt: number | undefined, now: number) {
  if (!endsAt || !Number.isFinite(endsAt)) return null;
  const total = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function acquiredText(timestamp: number | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return 'No live reading yet';
  return `Updated ${new Date(timestamp).toLocaleString()}`;
}

function ManualReadingButton({ onClick, label = 'Add observation' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="min-h-14 px-5 rounded-xl bg-indigo-700 text-white text-base font-black flex items-center justify-center gap-2 active:scale-[0.99] transition-transform">
      <Thermometer className="w-5 h-5" aria-hidden="true" />{label}
    </button>
  );
}

function RefreshButton({ refreshing, acquiredAt, onClick, dark = true, label }: { refreshing: boolean; acquiredAt?: number; onClick: () => void; dark?: boolean; label?: string }) {
  const caption = refreshing ? 'Refreshing…' : acquiredText(acquiredAt);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      title={caption}
      aria-label={label ? `${label}. ${caption}` : caption}
      className={`${label ? 'min-h-14 px-5 gap-2 rounded-xl' : 'w-12 h-12 rounded-xl'} ${dark ? 'bg-white/10 text-white' : 'bg-slate-950 text-white'} disabled:opacity-60 flex items-center justify-center font-black active:scale-[0.98] transition-transform`}
    >
      <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
      {label && <span>{refreshing ? 'Refreshing…' : label}</span>}
    </button>
  );
}

function EquipmentButton({ label, icon, on, highlighted = false, disabled, busy, statusText, onToggle }: { label: string; icon: React.ReactNode; on: boolean; highlighted?: boolean; disabled: boolean; busy: boolean; statusText?: string; onToggle: () => void; }) {
  const active = on || highlighted;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onToggle}
      className={`min-h-24 rounded-2xl border-2 px-3 py-4 flex flex-col items-center justify-center gap-2 text-center transition-colors disabled:opacity-55 ${active ? 'border-indigo-700 bg-indigo-700 text-white' : 'border-slate-200 bg-white text-slate-900'}`}
    >
      {busy ? <Loader2 className="w-7 h-7 animate-spin" aria-hidden="true" /> : icon}
      <span className="text-base font-black leading-tight">{label}</span>
      <span className={`text-sm font-black tabular-nums ${active ? 'text-indigo-100' : 'text-slate-600'}`}>{busy ? 'Updating…' : statusText ?? (on ? 'On' : 'Off')}</span>
    </button>
  );
}

export function Home({ state }: HomeProps) {
  const waterBody = useMemo(() => state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) ?? state.domain.waterBodies[0], [state.domain.waterBodies, state.domain.activeWaterBodyId]);
  const connectivity = waterBody?.connectivity ?? 'wifi';
  const liveConnectorAvailable = waterBody?.connectorId === 'cleverspa';
  const expectedConnectedTub = connectivity === 'wifi' && liveConnectorAvailable;
  const initialCachedStatus = waterBody ? readCachedSpaStatus(waterBody.id) : null;
  const [status, setStatus] = useState<SpaStatusDto | null>(initialCachedStatus);
  const [lastKnownStatus, setLastKnownStatus] = useState<SpaStatusDto | null>(initialCachedStatus);
  const [reachable, setReachable] = useState(false);
  const [connectionChecked, setConnectionChecked] = useState(!expectedConnectedTub);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showManualLog, setShowManualLog] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [bubbleAutoRestartPreference, setBubbleAutoRestartPreference] = useState(() => {
    try { return window.localStorage.getItem(BUBBLE_AUTO_RESTART_KEY) === 'true'; } catch { return false; }
  });
  const refreshInFlight = useRef(false);

  const refresh = async (manual = false) => {
    if (!waterBody || !expectedConnectedTub || refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (manual) {
      setRefreshing(true);
      if (!reachable) setConnectionChecked(false);
    }
    setError('');
    try {
      const next = await spaApi.status();
      const connected = Boolean(next.connected);
      setStatus(next);
      setReachable(connected);
      if (connected) {
        setLastKnownStatus(next);
        cacheConnectedSpaStatus(waterBody.id, next);
      }
    } catch (err: any) {
      setReachable(false);
      setError(err?.message || 'Hot tub unavailable.');
    } finally {
      refreshInFlight.current = false;
      setConnectionChecked(true);
      if (manual) setRefreshing(false);
      setNow(Date.now());
    }
  };

  useEffect(() => {
    if (!expectedConnectedTub || !waterBody) {
      setReachable(false);
      setConnectionChecked(true);
      return;
    }

    const cached = readCachedSpaStatus(waterBody.id);
    setStatus(cached);
    setLastKnownStatus(cached);
    setReachable(false);
    setConnectionChecked(false);
    setError('');
    void refresh(false);

    const pollTimer = window.setInterval(() => void refresh(false), 15000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(pollTimer); window.clearInterval(clockTimer); };
  }, [waterBody?.id, connectivity, liveConnectorAvailable]);

  const command = async (name: string, action: () => Promise<SpaStatusDto>) => {
    setBusy(name);
    setError('');
    try {
      const next = await action();
      const connected = Boolean(next.connected);
      setStatus(next);
      setReachable(connected);
      setConnectionChecked(true);
      if (connected && waterBody) {
        setLastKnownStatus(next);
        cacheConnectedSpaStatus(waterBody.id, next);
      }
      setNow(Date.now());
    } catch (err: any) {
      setError(err?.message || 'Command failed.');
      if (!String(err?.message || '').toLowerCase().includes('cooling down')) {
        setReachable(false);
        setConnectionChecked(true);
      }
    } finally {
      setBusy(null);
    }
  };

  const updateBubbleAutoRestart = async (enabled: boolean) => {
    setBubbleAutoRestartPreference(enabled);
    try { window.localStorage.setItem(BUBBLE_AUTO_RESTART_KEY, String(enabled)); } catch { /* storage is optional */ }
    if (!status || status.bubblePhase === 'idle') return;
    setBusy('bubble-auto-restart');
    setError('');
    try {
      const bubbleState = await spaApi.setBubbleAutoRestart(enabled);
      setStatus(current => current ? { ...current, ...bubbleState } : current);
    } catch (err: any) {
      setError(err?.message || 'Could not update bubble restart.');
    } finally {
      setBusy(null);
    }
  };

  if (!waterBody) return null;
  const manualModal = showManualLog ? <ManualLogModal state={state} onClose={() => setShowManualLog(false)} /> : null;

  if (connectivity === 'none') return <>
    <div className="p-4 max-w-xl mx-auto">
      <section className="rounded-3xl bg-white border border-slate-200 p-6">
        <div className="flex items-center gap-3 text-slate-700"><WifiOff className="w-6 h-6" aria-hidden="true" /><span className="font-black">Manual monitoring</span></div>
        <h2 className="text-3xl font-black text-slate-950 mt-3">{waterBody.name}</h2>
        <div className="mt-5"><ManualReadingButton onClick={() => setShowManualLog(true)} /></div>
      </section>
    </div>{manualModal}
  </>;

  if (!liveConnectorAvailable) return <>
    <div className="p-4 max-w-xl mx-auto">
      <section className="rounded-3xl bg-white border border-slate-200 p-6">
        <div className="flex items-center gap-3 text-indigo-800"><Wifi className="w-6 h-6" aria-hidden="true" /><span className="font-black">Wi-Fi connector unavailable</span></div>
        <h2 className="text-3xl font-black text-slate-950 mt-3">{waterBody.name}</h2>
        <div className="mt-5"><ManualReadingButton onClick={() => setShowManualLog(true)} /></div>
      </section>
    </div>{manualModal}
  </>;

  const connectionRefreshing = expectedConnectedTub && !connectionChecked;
  const displayedStatus = reachable ? status : (lastKnownStatus ?? status);
  const lastContactAt = displayedStatus?.lastContactAt || displayedStatus?.updatedAt;
  const current = finiteNumber(displayedStatus?.waterTemperatureC) ? displayedStatus.waterTemperatureC : null;
  const statusTarget = finiteNumber(displayedStatus?.targetTemperatureC) ? displayedStatus.targetTemperatureC : null;
  const fallbackTarget = finiteNumber(state.config.defaultHeatingTarget) ? state.config.defaultHeatingTarget : 40;
  const target = statusTarget ?? fallbackTarget;
  const dataAge = ageText(displayedStatus?.updatedAt, now);
  const contactAge = ageText(lastContactAt, now);

  if (connectionChecked && !reachable) return <>
    <div className="p-4 max-w-xl mx-auto">
      <section className="rounded-3xl bg-white border border-slate-200 p-6">
        <div className="flex items-center gap-3 text-slate-700"><WifiOff className="w-6 h-6" aria-hidden="true" /><span className="font-black">Not connected</span></div>
        <h2 className="text-3xl font-black text-slate-950 mt-3">{waterBody.name}</h2>
        {current !== null
          ? <p role="status" className="mt-3 text-base font-bold text-slate-600">Last water {Math.round(current)}° · {dataAge}</p>
          : <p role="status" className="mt-3 text-base font-bold text-slate-600">No live reading yet</p>}
        {lastContactAt && <p className="mt-1 text-sm font-bold text-slate-500">Last contact {contactAge}</p>}
        {error && <p role="alert" className="mt-3 text-sm font-bold text-slate-800 bg-slate-100 rounded-xl p-3">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <RefreshButton refreshing={refreshing} acquiredAt={displayedStatus?.updatedAt} onClick={() => void refresh(true)} dark={false} label="Try again" />
          <ManualReadingButton onClick={() => setShowManualLog(true)} />
        </div>
      </section>
    </div>{manualModal}
  </>;

  const disabled = connectionRefreshing || !status || !reachable || busy !== null;
  const setTarget = (value: number) => {
    const max = state.config.maxTemp || 40;
    void command('target', () => spaApi.setTargetTemperature(Math.max(5, Math.min(max, value))));
  };

  const bubblePhase = displayedStatus?.bubblePhase ?? (displayedStatus?.bubblesOn ? 'running' : 'idle');
  const bubbleRunCountdown = countdownText(displayedStatus?.bubbleRunEndsAt, now);
  const bubbleCooldownCountdown = countdownText(displayedStatus?.bubbleCooldownEndsAt, now);
  const bubbleStatusText = !displayedStatus
    ? '—'
    : bubblePhase === 'cooldown'
      ? `${bubbleCooldownCountdown ?? '—'} wait`
      : displayedStatus.bubblesOn && displayedStatus.bubbleTimingKnown && bubbleRunCountdown
        ? `${bubbleRunCountdown} left`
        : displayedStatus.bubblesOn ? 'On' : 'Off';
  const bubbleCooling = bubblePhase === 'cooldown';
  const bubbleHasCooldown = finiteNumber(displayedStatus?.bubbleCooldownSeconds) && displayedStatus.bubbleCooldownSeconds > 0;
  const bubbleRestartUsed = Boolean(displayedStatus?.bubbleAutoRestartUsed);
  const bubbleRestartChecked = bubblePhase === 'idle' ? bubbleAutoRestartPreference : Boolean(displayedStatus?.bubbleAutoRestartEnabled);

  return <>
    <div className="p-4 max-w-xl mx-auto space-y-5">
      <section className="rounded-3xl bg-slate-950 text-white p-5 sm:p-6 overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`flex items-center gap-2 ${connectionRefreshing ? 'text-slate-300' : 'text-emerald-300'}`}>
              {connectionRefreshing ? <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" /> : <Wifi className="w-5 h-5" aria-hidden="true" />}
              <span className="font-black text-sm">{connectionRefreshing ? 'Refreshing…' : 'Live'}</span>
            </div>
            <h2 className="text-lg font-black mt-2 text-white">{waterBody.name}</h2>
          </div>
          <RefreshButton refreshing={refreshing || connectionRefreshing} acquiredAt={displayedStatus?.updatedAt} onClick={() => void refresh(true)} />
        </div>

        <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-5">
          <div>
            <p className="text-sm font-black text-slate-400">{connectionRefreshing && current !== null ? 'Last water' : 'Water'}</p>
            <p className="text-7xl font-black tabular-nums tracking-tight mt-1">{current === null ? '—' : `${Math.round(current)}°`}</p>
          </div>

          <div className="text-right">
            <p className="text-sm font-black text-slate-400">Target</p>
            <p className="text-4xl font-black tabular-nums tracking-tight mt-1">{target.toFixed(0)}°</p>
            <div className="mt-2 flex items-center justify-end gap-2">
              <button type="button" disabled={disabled} onClick={() => setTarget(target - 1)} className="w-12 h-12 rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center disabled:opacity-40" aria-label="Lower target temperature"><Minus className="w-6 h-6" aria-hidden="true" /></button>
              <button type="button" disabled={disabled} onClick={() => setTarget(target + 1)} className="w-12 h-12 rounded-xl bg-white text-slate-950 flex items-center justify-center disabled:opacity-40" aria-label="Raise target temperature"><Plus className="w-6 h-6" aria-hidden="true" /></button>
            </div>
          </div>
        </div>

        {connectionRefreshing && displayedStatus && <p className="mt-4 text-sm font-bold text-slate-300">Last reading {dataAge}. Controls paused while refreshing.</p>}
        {connectionRefreshing && !displayedStatus && <p className="mt-4 text-sm font-bold text-slate-300">Waiting for the first live reading.</p>}
        {current === null && !connectionRefreshing && <p className="mt-3 text-sm font-bold text-amber-200">No usable water temperature.</p>}
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-3 px-1">
          <h3 className="text-xl font-black text-slate-950">Equipment</h3>
          {connectionRefreshing && <span className="text-sm font-black text-slate-600">{displayedStatus ? 'Last known' : 'Refreshing'}</span>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <EquipmentButton label="Filter" icon={<Waves className="w-7 h-7" aria-hidden="true" />} on={Boolean(displayedStatus?.filterOn)} busy={busy === 'filter'} disabled={disabled} statusText={displayedStatus ? undefined : '—'} onToggle={() => status && void command('filter', () => spaApi.setFilter(!status.filterOn))} />
          <EquipmentButton label="Heater" icon={<Flame className="w-7 h-7" aria-hidden="true" />} on={Boolean(displayedStatus?.heaterOn)} busy={busy === 'heater'} disabled={disabled} statusText={displayedStatus ? undefined : '—'} onToggle={() => status && void command('heater', () => spaApi.setHeater(!status.heaterOn))} />
          <EquipmentButton
            label="Bubbles"
            icon={<Wind className="w-7 h-7" aria-hidden="true" />}
            on={Boolean(displayedStatus?.bubblesOn)}
            highlighted={bubbleCooling}
            busy={busy === 'bubbles'}
            disabled={disabled || bubbleCooling}
            statusText={bubbleStatusText}
            onToggle={() => status && void command('bubbles', () => spaApi.setBubbles(!status.bubblesOn, !status.bubblesOn && bubbleAutoRestartPreference))}
          />
        </div>

        {bubbleHasCooldown && <label className={`mt-3 min-h-12 px-1 flex items-center justify-between gap-4 text-sm font-black ${bubbleRestartUsed ? 'text-slate-500' : 'text-slate-800'}`}>
          <span>{bubbleRestartUsed ? 'Auto restart used' : 'Restart bubbles once'}</span>
          <input
            type="checkbox"
            className="w-6 h-6 accent-indigo-700"
            checked={bubbleRestartChecked}
            disabled={disabled || bubbleRestartUsed || busy === 'bubble-auto-restart'}
            onChange={event => void updateBubbleAutoRestart(event.target.checked)}
          />
        </label>}
      </section>

      {error && <div role="alert" className="rounded-2xl p-4 text-sm font-bold bg-white text-slate-800 border border-slate-200">{error}</div>}
    </div>{manualModal}
  </>;
}
