import React, { useState } from 'react';
import { LogIn, LogOut, Waves } from 'lucide-react';
import type { AppState } from '../types';
import type { BathingEpisode } from '../domain/models';
import { logEvent } from '../lib/firebase';
import { formatLogTime } from '../lib/dateTime';

interface BathingControlsProps {
  state: AppState;
  updateState: (newState: AppState) => void;
}

function relevantHeatingSessionId(state: AppState, timestamp: number) {
  const candidates = (state.heatingSessions || [])
    .filter(session => session.targetTime >= timestamp - (2 * 60 * 60 * 1000) && session.targetTime <= timestamp + (12 * 60 * 60 * 1000))
    .sort((a, b) => Math.abs(a.targetTime - timestamp) - Math.abs(b.targetTime - timestamp));
  return candidates[0]?.id;
}

export function BathingControls({ state, updateState }: BathingControlsProps) {
  const [busy, setBusy] = useState(false);
  const waterBody = state.domain.waterBodies.find(item => item.id === state.domain.activeWaterBodyId) ?? state.domain.waterBodies[0];
  const activeEpisode = state.domain.bathingEpisodes
    .filter(episode => episode.waterBodyId === waterBody?.id && episode.status === 'active')
    .sort((a, b) => b.startedAt - a.startedAt)[0];

  if (!waterBody) return null;

  const gettingIn = () => {
    if (activeEpisode || busy) return;
    setBusy(true);
    const timestamp = Date.now();
    const episode: BathingEpisode = {
      id: crypto.randomUUID(),
      waterBodyId: waterBody.id,
      startedAt: timestamp,
      status: 'active',
      source: 'user_confirmed',
      heatingSessionId: relevantHeatingSessionId(state, timestamp)
    };
    updateState({
      ...state,
      domain: {
        ...state.domain,
        bathingEpisodes: [episode, ...state.domain.bathingEpisodes]
      }
    });
    void logEvent('manual_log', {
      action: 'entered_tub',
      manualTimestamp: timestamp,
      bathingEpisodeId: episode.id,
      heatingSessionId: episode.heatingSessionId
    });
    setBusy(false);
  };

  const gettingOut = () => {
    if (!activeEpisode || busy) return;
    setBusy(true);
    const timestamp = Date.now();
    updateState({
      ...state,
      domain: {
        ...state.domain,
        bathingEpisodes: state.domain.bathingEpisodes.map(episode => episode.id === activeEpisode.id
          ? { ...episode, status: 'completed' as const, endedAt: timestamp }
          : episode)
      }
    });
    void logEvent('manual_log', {
      action: 'exited_tub',
      manualTimestamp: timestamp,
      bathingEpisodeId: activeEpisode.id,
      heatingSessionId: activeEpisode.heatingSessionId
    });
    setBusy(false);
  };

  const active = Boolean(activeEpisode);
  const panelClass = active
    ? 'bg-emerald-950 border-emerald-900 text-white'
    : 'bg-slate-900 border-slate-800 text-white';

  return (
    <div className="px-4 pb-5 max-w-xl mx-auto">
      <section className={`rounded-3xl border p-5 shadow-sm ${panelClass}`} aria-live="polite">
        <div className="flex items-start gap-4">
          <span className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${active ? 'bg-emerald-800 text-emerald-50' : 'bg-white/10 text-sky-200'}`}>
            <Waves className="w-7 h-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-black uppercase tracking-widest ${active ? 'text-emerald-200' : 'text-slate-300'}`}>Bathing</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">
              {activeEpisode ? 'You’re in the spa' : 'Not bathing now'}
            </h2>
            <p className={`mt-1 text-sm leading-relaxed ${active ? 'text-emerald-100' : 'text-slate-300'}`}>
              {activeEpisode
                ? `Started ${formatLogTime(activeEpisode.startedAt, state.config.timeFormat)}. Tap when you get out so the session is recorded accurately.`
                : 'Tap as you get in. Spararama uses this marker to separate real bathing from heating, filtering and bubble tests.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={activeEpisode ? gettingOut : gettingIn}
          className="mt-5 w-full min-h-16 rounded-2xl bg-white text-slate-950 disabled:opacity-60 text-lg font-black flex items-center justify-center gap-3 shadow-sm active:scale-[0.99] transition-transform"
        >
          {activeEpisode ? <LogOut className="w-6 h-6" /> : <LogIn className="w-6 h-6" />}
          {busy ? 'Recording…' : activeEpisode ? 'Getting out' : 'Getting in'}
        </button>
      </section>
    </div>
  );
}
