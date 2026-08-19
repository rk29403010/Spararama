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

  return (
    <div className="px-4 pb-5 max-w-xl mx-auto">
      <section className={`rounded-3xl border p-5 shadow-sm ${activeEpisode ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3 mb-4">
          <span className={`w-11 h-11 rounded-2xl flex items-center justify-center ${activeEpisode ? 'bg-emerald-600 text-white' : 'bg-sky-100 text-sky-700'}`}>
            <Waves className="w-6 h-6" />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Bathing episode</p>
            <p className="font-extrabold text-slate-900">
              {activeEpisode ? `In the spa since ${formatLogTime(activeEpisode.startedAt, state.config.timeFormat)}` : 'Not currently bathing'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={Boolean(activeEpisode) || busy}
            onClick={gettingIn}
            className="min-h-16 rounded-2xl bg-indigo-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-lg font-black flex items-center justify-center gap-2"
          >
            <LogIn className="w-6 h-6" /> Getting In
          </button>
          <button
            type="button"
            disabled={!activeEpisode || busy}
            onClick={gettingOut}
            className="min-h-16 rounded-2xl bg-slate-900 disabled:bg-slate-200 disabled:text-slate-400 text-white text-lg font-black flex items-center justify-center gap-2"
          >
            <LogOut className="w-6 h-6" /> Getting Out
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">These explicit markers anchor later bubble/temperature inference instead of assuming bubbles always mean someone was in the tub.</p>
      </section>
    </div>
  );
}
