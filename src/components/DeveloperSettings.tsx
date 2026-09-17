import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { systemApi, type SystemUpdateStatusDto } from '../lib/systemApi';

const DEVELOPER_MODE_KEY = 'spararama.developerMode';
const UPDATE_PENDING_KEY = 'spararama.updatePendingStartedAt';

function initialDeveloperMode() {
  try { return window.localStorage.getItem(DEVELOPER_MODE_KEY) === 'true'; } catch { return false; }
}

function readPendingUpdate() {
  try {
    const value = Number(window.sessionStorage.getItem(UPDATE_PENDING_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function rememberPendingUpdate(startedAt: number | undefined) {
  if (!Number.isFinite(startedAt)) return;
  try { window.sessionStorage.setItem(UPDATE_PENDING_KEY, String(startedAt)); } catch { /* optional */ }
}

function clearPendingUpdate() {
  try { window.sessionStorage.removeItem(UPDATE_PENDING_KEY); } catch { /* optional */ }
}

export function DeveloperSettings() {
  const [developerMode, setDeveloperMode] = useState(initialDeveloperMode);
  const [status, setStatus] = useState<SystemUpdateStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  function clearPoll() {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }

  async function loadStatus() {
    const next = await systemApi.updateStatus();
    setStatus(next);
    return next;
  }

  function finishSuccessfulUpdate(next: SystemUpdateStatusDto) {
    clearPoll();
    setStatus(next);
    setBusy(false);

    const pendingStartedAt = readPendingUpdate();
    const thisBrowserStartedIt = pendingStartedAt !== null && next.update.startedAt === pendingStartedAt;
    if (thisBrowserStartedIt) {
      clearPendingUpdate();
      setMessage(`Updated to ${next.commit || 'the latest version'}. Reloading…`);
      pollTimer.current = window.setTimeout(() => window.location.reload(), 600);
      return;
    }

    setMessage(`Updated to ${next.commit || 'the latest version'}.`);
  }

  function pollUntilRestarted(expectedStartedAt: number | null) {
    clearPoll();
    const poll = async () => {
      try {
        const next = await loadStatus();
        const belongsToThisRun = expectedStartedAt === null || next.update.startedAt === expectedStartedAt;
        if (belongsToThisRun && next.update.state === 'succeeded') {
          finishSuccessfulUpdate(next);
          return;
        }
        if (belongsToThisRun && next.update.state === 'failed') {
          clearPendingUpdate();
          setMessage(next.update.message || 'Update failed.');
          setBusy(false);
          return;
        }
        setBusy(true);
        setMessage(next.update.state === 'running' ? 'Updating Spararama…' : 'Waiting for restart to finish…');
      } catch {
        setBusy(true);
        setMessage('Restarting backend…');
      }
      pollTimer.current = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
  }

  useEffect(() => () => clearPoll(), []);

  useEffect(() => {
    if (!developerMode) return;
    let active = true;
    loadStatus().then(next => {
      if (!active) return;
      const pendingStartedAt = readPendingUpdate();
      if (next.update.state === 'running') {
        setBusy(true);
        setMessage('Updating Spararama…');
        pollUntilRestarted(next.update.startedAt ?? pendingStartedAt);
      } else if (next.update.state === 'succeeded' && pendingStartedAt !== null && next.update.startedAt === pendingStartedAt) {
        finishSuccessfulUpdate(next);
      } else if (next.update.state === 'failed' && pendingStartedAt !== null && next.update.startedAt === pendingStartedAt) {
        clearPendingUpdate();
        setBusy(false);
        setMessage(next.update.message || 'Update failed.');
      }
    }).catch(error => {
      if (active) setMessage(error?.message || 'Unable to read backend update status.');
    });
    return () => {
      active = false;
      clearPoll();
    };
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

  const updateAndRestart = async () => {
    setBusy(true);
    setMessage('Checking for updates…');
    try {
      const next = await systemApi.updateAndRestart();
      setStatus(next);
      if (next.outcome === 'up-to-date') {
        clearPendingUpdate();
        setBusy(false);
        setMessage('Already up to date.');
        return;
      }

      rememberPendingUpdate(next.update.startedAt);
      setMessage('Updating Spararama…');
      pollUntilRestarted(next.update.startedAt ?? null);
    } catch (error: any) {
      setMessage(error?.message || 'Unable to start update.');
      setBusy(false);
    }
  };

  const working = busy || status?.update.state === 'running';
  const checking = busy && message === 'Checking for updates…';

  return (
    <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-4">
      <div className="flex items-center gap-2">
        <Wrench className="w-5 h-5 text-indigo-700 shrink-0" aria-hidden="true" />
        <h3 className="text-xl font-black text-slate-950">Developer Mode</h3>
      </div>

      <label className="min-h-12 flex items-center justify-between gap-4 cursor-pointer">
        <span className="font-black text-slate-800 text-base sm:text-lg">Enable</span>
        <input type="checkbox" checked={developerMode} onChange={event => setDeveloper(event.target.checked)} className="w-6 h-6 accent-indigo-700" />
      </label>

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
                  disabled={working || status.dirty}
                  onClick={() => void updateAndRestart()}
                  className="min-h-12 px-4 rounded-xl bg-slate-950 text-white font-black disabled:opacity-45 flex items-center gap-2 shrink-0"
                >
                  <RefreshCw className={`w-5 h-5 ${working ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {checking ? 'Checking…' : working ? 'Updating…' : 'Update & restart'}
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
