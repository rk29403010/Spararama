import React, { useEffect, useState } from 'react';
import { CirclePower, Loader2, RefreshCw } from 'lucide-react';
import { spaApi, type SpaStatusDto } from '../lib/spaApi';

export function SpaStatusCard() {
  const [status, setStatus] = useState<SpaStatusDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      setError('');
      setStatus(await spaApi.status());
    } catch (err: any) {
      setError(err?.message || 'Unable to read spa status');
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(id);
  }, []);

  const command = async (name: string, action: () => Promise<SpaStatusDto>) => {
    setBusy(name);
    setError('');
    try {
      setStatus(await action());
    } catch (err: any) {
      setError(err?.message || 'Spa command failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${status?.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400">{status?.transport || '...'}</span>
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-4xl font-black text-slate-900 tabular-nums">{status ? status.waterTemperatureC.toFixed(1) : '--'}°</span>
            <span className="text-sm font-bold text-slate-400 pb-1">target {status ? status.targetTemperatureC.toFixed(0) : '--'}°C</span>
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-600" aria-label="Refresh spa status">
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!status || busy !== null}
          onClick={() => status && void command('filter', () => spaApi.setFilter(!status.filterOn))}
          className={`min-h-14 rounded-2xl px-4 font-extrabold flex items-center justify-center gap-2 ${status?.filterOn ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700'}`}
        >
          {busy === 'filter' ? <Loader2 className="w-5 h-5 animate-spin" /> : <CirclePower className="w-5 h-5" />}
          Filter {status?.filterOn ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          disabled={!status || busy !== null}
          onClick={() => status && void command('heater', () => spaApi.setHeater(!status.heaterOn))}
          className={`min-h-14 rounded-2xl px-4 font-extrabold flex items-center justify-center gap-2 ${status?.heaterOn ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700'}`}
        >
          {busy === 'heater' ? <Loader2 className="w-5 h-5 animate-spin" /> : <CirclePower className="w-5 h-5" />}
          Heat {status?.heaterOn ? 'On' : 'Off'}
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-50 text-red-700 p-3 text-sm font-semibold">{error}</div>}
    </section>
  );
}
