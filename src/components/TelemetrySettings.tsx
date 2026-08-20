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
      setMessage('Saved');
    } catch (error: any) {
      setMessage(error?.message || 'Unable to save telemetry settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-3">
      <label className="flex items-center justify-between gap-4">
        <span className="font-black text-slate-800 text-base sm:text-lg flex items-center gap-2">
          <Radio className="w-5 h-5 text-indigo-700" aria-hidden="true" />Telemetry frequency
        </span>
        <select
          aria-label="Telemetry frequency"
          value={intervalSeconds ?? ''}
          disabled={intervalSeconds === null || saving}
          onChange={event => void updateInterval(Number(event.target.value))}
          className="min-h-12 bg-slate-100 text-slate-950 font-black px-3 rounded-xl disabled:opacity-50"
        >
          {intervalSeconds === null && <option value="">Loading…</option>}
          {OPTIONS.map(option => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}
        </select>
      </label>
      {message && <p role="status" className="text-sm font-bold text-slate-600">{message}</p>}
    </div>
  );
}
