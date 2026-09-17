import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { systemApi, type SystemUpdateStatusDto } from '../lib/systemApi';

const DEVELOPER_MODE_KEY = 'spararama.developerMode';

function initialDeveloperMode() {
  try { return window.localStorage.getItem(DEVELOPER_MODE_KEY) === 'true'; } catch { return false; }
}

export function DeveloperSettings() {
  const [developerMode, setDeveloperMode] = useState(initialDeveloperMode);
  const [status, setStatus] = useState<SystemUpdateStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const updateStartedAt = useRef<number | null>(null);

  const clearPoll = () => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  useEffect(() => () => clearPoll(), []);

  const loadStatus = async () => {
    const next = await systemApi.updateStatus();
    setStatus(next);
    return next;
  };

  useEffect(() => {
    if (!developerMode) return;
    let active = true;
    loadStatus().catch(error => {
      if (active) setMessage(error?.message || 'Unable to read backend update status.');
    });
    return () => { active = false; };
  }, [developerMode]);

  const setDeveloper = (enabled: boolean) => {
    setDeveloperMode(enabled);
    setMessage(null);
    try { window.localStorage.setItem(DEVELOPER_MODE_KEY, String(enabled)); } catch { /* optional */ }
    if (!enabled) {
      clearPoll();
      setBusy(false);
    }
  };

  const pollUntilRestarted = () => {
    clearPoll();
    const poll = async () => {
      try {
        const next = await loadStatus();
        const startedAt = updateStartedAt.current;
        const belongsToThisRun = startedAt === null || next.update.startedAt === startedAt;
        if (belongsToThisRun && next.update.state === 'succeeded') {
          setMessage(`Updated to ${next.commit || 'the latest version'}. Reloading…`);
          setBusy(false);
          window.setTimeout(() => window.location.reload(), 600);
          return;
        }
        if (belongsToThisRun && next.update.state === 'failed') {
          setMessage(next.update.message || 'Update failed.');
          setBusy(false);
          return;
        }
        setMessage(next.update.state === 'running' ? 'Updating Spararama…' : 'Restarting backend…');
      } catch {
        setMessage('Restarting backend…');
      }
      pollTimer.current = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
  };

  const updateAndRestart = async () => {
    setBusy(true);
    setMessage('Starting update…');
    updateStartedAt.current = null;
    try {
      const next = await systemApi.updateAndRestart();
      updateStartedAt.current = next.update.startedAt || null;
      setStatus(next);
      pollUntilRestarted();
    } catch (error: any) {
      setMessage(error?.message || 'Unable to start update.');
      setBusy(false);
    }
  };

  return (
    <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Wrench className="w-5 h-5 text-indigo-700 shrink-0" aria-hidden="true" />
          <h3 className="text-xl font-black text-slate-950">Developer</h3>
        </div>
        <label className="min-h-12 flex items-center gap-3 font-black text-slate-700 cursor-pointer">
          <span>Mode</span>
          <input type="checkbox" checked={developerMode} onChange={event => setDeveloper(event.target.checked)} className="w-6 h-6 accent-indigo-700" />
        </label>
      </div>

      {developerMode && (
        <div className="border-t border-slate-200 pt-4 space-y-3">
          {status?.supported ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-black text-slate-800">Backend version</div>
                  <div className="text-sm font-bold text-slate-600 truncate">
                    {status.currentBranch || status.branch || 'branch unknown'}{status.commit ? ` · ${status.commit}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy || status.update.state === 'running' || status.dirty}
                  onClick={() => void updateAndRestart()}
                  className="min-h-12 px-4 rounded-xl bg-slate-950 text-white font-black disabled:opacity-45 flex items-center gap-2 shrink-0"
                >
                  <RefreshCw className={`w-5 h-5 ${busy || status.update.state === 'running' ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {busy || status.update.state === 'running' ? 'Updating…' : 'Update & restart'}
                </button>
              </div>
              {status.dirty && <p role="alert" className="text-sm font-bold text-amber-900">Local changes detected - update is disabled.</p>}
            </>
          ) : (
            <p className="text-sm font-bold text-slate-600">{status?.reason || 'Checking backend update support…'}</p>
          )}

          {message && <p role="status" className="text-sm font-bold text-slate-600 break-words">{message}</p>}
        </div>
      )}
    </section>
  );
}
