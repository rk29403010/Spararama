import React, { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { telemetryApi } from '../lib/telemetryApi';

const OPTIONS = [
  { seconds: 60, label: 'Every minute' },
  { seconds: 300, label: 'Every 5 minutes' },
  { seconds: 900, label: 'Every 15 minutes' },
  { seconds: 1800, label: 'Every 30 minutes' }
];

export function TelemetrySettings() {
  const [intervalSeconds, setIntervalSeconds] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    telemetryApi.config()
      .then(config => setIntervalSeconds(config.intervalSeconds))
      .catch(error => setMessage(error?.message || 'Unable to load telemetry settings.'));
  }, []);

  const updateInterval = async (value: number) => {
    setSaving(true);
    setMessage(null);
    try {
      const config = await telemetryApi.updateConfig(value);
      setIntervalSeconds(config.intervalSeconds);
      setMessage('Saved. The always-on collector is using this interval now.');
    } catch (error: any) {
      setMessage(error?.message || 'Unable to save telemetry settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-3">
      <label className="flex items-center justify-between gap-4">
        <div>
          <span className="font-medium text-slate-700 text-lg flex items-center gap-2"><Radio className="w-5 h-5 text-indigo-500" />Telemetry frequency</span>
          <span className="text-xs text-slate-500 block mt-1">Stored by the backend and used even when no browser is open.</span>
        </div>
        <select
          aria-label="Telemetry frequency"
          value={intervalSeconds ?? ''}
          disabled={intervalSeconds === null || saving}
          onChange={event => void updateInterval(Number(event.target.value))}
          className="bg-slate-100 text-slate-900 font-bold px-3 py-2 rounded-xl outline-none disabled:opacity-50"
        >
          {intervalSeconds === null && <option value="">Loading…</option>}
          {OPTIONS.map(option => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}
        </select>
      </label>
      {message && <p className="text-xs text-slate-500">{message}</p>}
    </div>
  );
}
