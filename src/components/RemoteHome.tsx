import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { Clock3, Flame, RefreshCw, Waves, Wifi, WifiOff, Wind } from 'lucide-react';
import {
  remoteCloudApi,
  type CloudInstallationState,
  type CloudInstallationSummary
} from '../lib/remoteCloudApi';

const SELECTED_INSTALLATION_KEY = 'spararama.remote.installation';

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ageText(ageMs: number | null) {
  if (ageMs === null || !Number.isFinite(ageMs)) return 'No recent update';
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 10) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}

function EquipmentState({ label, on, icon }: { label: string; on: boolean; icon: React.ReactNode }) {
  return (
    <div className={`min-h-20 rounded-2xl border px-3 py-3 flex flex-col items-center justify-center gap-1.5 ${on ? 'border-indigo-700 bg-indigo-700 text-white' : 'border-slate-200 bg-white text-slate-800'}`}>
      {icon}
      <span className="font-black">{label}</span>
      <span className={`text-sm font-bold ${on ? 'text-indigo-100' : 'text-slate-500'}`}>{on ? 'On' : 'Off'}</span>
    </div>
  );
}

export function RemoteHome({ user }: { user: User }) {
  const [installations, setInstallations] = useState<CloudInstallationSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [snapshot, setSnapshot] = useState<CloudInstallationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    remoteCloudApi.installations(user)
      .then(items => {
        if (cancelled) return;
        setInstallations(items);
        let stored = '';
        try { stored = window.localStorage.getItem(SELECTED_INSTALLATION_KEY) || ''; } catch { /* optional */ }
        const selected = items.find(item => item.installationId === stored)?.installationId
          || items[0]?.installationId
          || '';
        setSelectedId(selected);
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Remote access unavailable.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user.uid]);

  const refresh = useCallback(async (showSpinner = false) => {
    if (!selectedId) {
      setSnapshot(null);
      return;
    }
    if (showSpinner) setRefreshing(true);
    try {
      const next = await remoteCloudApi.state(user, selectedId);
      setSnapshot(next);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refresh the hot tub.');
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, [selectedId, user]);

  useEffect(() => {
    if (!selectedId) return;
    try { window.localStorage.setItem(SELECTED_INSTALLATION_KEY, selectedId); } catch { /* optional */ }
    setSnapshot(null);
    void refresh(false);
    const timer = window.setInterval(() => void refresh(false), 15_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [selectedId, refresh]);

  if (loading) {
    return (
      <div className="p-4 max-w-xl mx-auto">
        <section className="rounded-3xl bg-white border border-slate-200 p-6 flex items-center gap-3 text-slate-700">
          <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span className="font-black">Loading hot tub…</span>
        </section>
      </div>
    );
  }

  if (!installations.length) {
    return (
      <div className="p-4 max-w-xl mx-auto">
        <section className="rounded-3xl bg-white border border-slate-200 p-6">
          <WifiOff className="w-7 h-7 text-slate-600" aria-hidden="true" />
          <h2 className="text-2xl font-black text-slate-950 mt-3">No hot tub linked</h2>
          <p className="mt-2 font-bold text-slate-600">This account does not have access to a Spararama installation yet.</p>
        </section>
      </div>
    );
  }

  const spa = snapshot?.runtime?.state?.spa;
  const freshness = snapshot?.freshness.status || 'offline';
  const genuinelyLive = freshness === 'fresh' && Boolean(spa?.connected);
  const selected = installations.find(item => item.installationId === selectedId);
  const water = finiteNumber(spa?.waterTemperatureC) ? spa.waterTemperatureC : null;
  const target = finiteNumber(spa?.targetTemperatureC) ? spa.targetTemperatureC : null;
  const activeHeating = snapshot?.runtime?.state?.activeHeatingSchedule;

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      {installations.length > 1 && (
        <label className="block">
          <span className="sr-only">Hot tub</span>
          <select
            value={selectedId}
            onChange={event => setSelectedId(event.target.value)}
            className="w-full min-h-12 rounded-xl border border-slate-300 bg-white px-4 font-black text-slate-950"
          >
            {installations.map(item => (
              <option key={item.installationId} value={item.installationId}>
                {item.name || item.installationId}
              </option>
            ))}
          </select>
        </label>
      )}

      <section className="rounded-3xl bg-slate-950 text-white p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`flex items-center gap-2 text-sm font-black ${genuinelyLive ? 'text-emerald-300' : freshness === 'stale' ? 'text-amber-200' : 'text-slate-300'}`}>
              {genuinelyLive ? <Wifi className="w-5 h-5" aria-hidden="true" /> : <WifiOff className="w-5 h-5" aria-hidden="true" />}
              <span>{genuinelyLive ? 'Live' : freshness === 'stale' ? 'Last known' : 'Offline'}</span>
            </div>
            <h2 className="text-lg font-black mt-2">{snapshot?.name || selected?.name || selectedId}</h2>
          </div>
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={refreshing}
            className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center disabled:opacity-60"
            aria-label="Refresh remote status"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-[1fr_auto] gap-5 items-end">
          <div>
            <p className="text-sm font-black text-slate-400">{genuinelyLive ? 'Water' : 'Last water'}</p>
            <p className="text-7xl font-black tabular-nums tracking-tight mt-1">{water === null ? '—' : `${Math.round(water)}°`}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-black text-slate-400">Target</p>
            <p className="text-4xl font-black tabular-nums tracking-tight mt-1">{target === null ? '—' : `${Math.round(target)}°`}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-300">
          <Clock3 className="w-4 h-4" aria-hidden="true" />
          <span>{ageText(snapshot?.freshness.ageMs ?? null)}</span>
        </div>
      </section>

      {spa && (
        <section>
          <h3 className="text-lg font-black text-slate-950 mb-2 px-1">Equipment</h3>
          <div className="grid grid-cols-3 gap-3">
            <EquipmentState label="Filter" on={Boolean(spa.filterOn)} icon={<Waves className="w-6 h-6" aria-hidden="true" />} />
            <EquipmentState label="Heater" on={Boolean(spa.heaterOn)} icon={<Flame className="w-6 h-6" aria-hidden="true" />} />
            <EquipmentState label="Bubbles" on={Boolean(spa.bubblesOn)} icon={<Wind className="w-6 h-6" aria-hidden="true" />} />
          </div>
        </section>
      )}

      {activeHeating && (
        <section className="rounded-2xl bg-white border border-slate-200 px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-black text-slate-950">Heating plan</p>
            <p className="text-sm font-bold text-slate-600">{activeHeating.status}</p>
          </div>
          <div className="text-right">
            <p className="font-black text-slate-950 tabular-nums">{Math.round(activeHeating.targetTemperatureC)}°</p>
            <p className="text-sm font-bold text-slate-600">
              {new Date(activeHeating.targetTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </section>
      )}

      {!spa && !error && (
        <section className="rounded-2xl bg-white border border-slate-200 p-4 font-bold text-slate-600">
          Waiting for the home Spararama server to publish its first status.
        </section>
      )}

      {error && (
        <div role="alert" className="rounded-2xl bg-amber-50 border border-amber-200 p-4 font-bold text-amber-950">
          {error}
        </div>
      )}
    </div>
  );
}
