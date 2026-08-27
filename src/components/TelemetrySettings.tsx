import React, { useEffect, useState } from 'react';
import { Bell, Radio, Volume2 } from 'lucide-react';
import { alertsApi, type AlexaAlertStatus } from '../lib/alertsApi';
import { syncPushRegistration, testPushNotification } from '../lib/pushNotifications';
import { telemetryApi } from '../lib/telemetryApi';

const OPTIONS = [
  { seconds: 60, label: 'Every minute' },
  { seconds: 300, label: 'Every 5 minutes' },
  { seconds: 900, label: 'Every 15 minutes' },
  { seconds: 1800, label: 'Every 30 minutes' }
];

function playReadySignal() {
  if ('vibrate' in navigator) navigator.vibrate([300, 120, 300, 120, 650]);
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const startAt = context.currentTime + 0.02;
    [784, 988, 1175].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const toneStart = startAt + index * 0.22;
      const toneEnd = toneStart + 0.16;
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      gain.connect(context.destination);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(0.18, toneStart + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
      oscillator.start(toneStart);
      oscillator.stop(toneEnd + 0.02);
    });
    window.setTimeout(() => void context.close(), 1200);
  } catch {
    // Visual notification remains useful if browser audio is unavailable.
  }
}

export function TelemetrySettings() {
  const [intervalSeconds, setIntervalSeconds] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null);
  const [alexa, setAlexa] = useState<AlexaAlertStatus | null>(null);
  const [alexaEnabled, setAlexaEnabled] = useState(true);
  const [alexaDevice, setAlexaDevice] = useState('');
  const [alexaToken, setAlexaToken] = useState('');
  const [alexaChime, setAlexaChime] = useState('');
  const [alexaBusy, setAlexaBusy] = useState(false);
  const [alexaMessage, setAlexaMessage] = useState<string | null>(null);

  const applyAlexaStatus = (status: AlexaAlertStatus) => {
    setAlexa(status);
    setAlexaEnabled(status.enabled);
    if (status.device) setAlexaDevice(status.device);
  };

  useEffect(() => {
    telemetryApi.config()
      .then(config => setIntervalSeconds(config.intervalSeconds))
      .catch(error => setMessage(error?.message || 'Unable to load telemetry settings.'));
    alertsApi.alexaStatus()
      .then(applyAlexaStatus)
      .catch(error => setAlexaMessage(error?.message || 'Sign in to configure Alexa alerts.'));
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

  const testPhoneAlerts = async () => {
    setPhoneBusy(true);
    setPhoneMessage(null);
    try {
      const registration = await syncPushRegistration({ requestPermission: true });
      if (registration.status !== 'enabled') {
        setPhoneMessage(registration.message);
        return;
      }
      playReadySignal();
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Your hot tub is ready!', { tag: 'spararama-alert-test' });
      }
      const result = await testPushNotification();
      setPhoneMessage(result.successCount > 0
        ? 'Phone alerts enabled. Test push sent.'
        : 'Local sound/vibration tested. Background push has no active target yet.');
    } catch (error: any) {
      setPhoneMessage(error?.message || 'Unable to test phone alerts.');
    } finally {
      setPhoneBusy(false);
    }
  };

  const saveAlexa = async () => {
    setAlexaBusy(true);
    setAlexaMessage(null);
    try {
      const status = await alertsApi.updateAlexa({
        enabled: alexaEnabled,
        device: alexaDevice,
        token: alexaToken || undefined,
        chime: alexaChime || undefined
      });
      applyAlexaStatus(status);
      setAlexaToken('');
      setAlexaChime('');
      setAlexaMessage('Alexa settings saved securely.');
    } catch (error: any) {
      setAlexaMessage(error?.message || 'Unable to save Alexa settings.');
    } finally {
      setAlexaBusy(false);
    }
  };

  const testAlexa = async () => {
    setAlexaBusy(true);
    setAlexaMessage(null);
    try {
      const result = await alertsApi.testAlexa();
      setAlexaMessage(result.sent ? 'Alexa test sent.' : (result.error || 'Alexa is not configured.'));
    } catch (error: any) {
      setAlexaMessage(error?.message || 'Unable to test Alexa.');
    } finally {
      setAlexaBusy(false);
    }
  };

  return (
    <>
      <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-4">
        <h3 className="text-xl font-black text-slate-950 flex items-center gap-2"><Bell className="w-5 h-5 text-indigo-700" aria-hidden="true" />Alerts</h3>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-black text-slate-800 text-base sm:text-lg">Phone</div>
            <div className="text-sm font-bold text-slate-600">Notification + vibration + foreground chime</div>
          </div>
          <button type="button" disabled={phoneBusy} onClick={() => void testPhoneAlerts()} className="min-h-12 px-4 rounded-xl bg-indigo-700 text-white font-black disabled:opacity-50 flex items-center gap-2">
            <Volume2 className="w-5 h-5" aria-hidden="true" />{phoneBusy ? 'Testing…' : 'Enable / test'}
          </button>
        </div>
        {phoneMessage && <p role="status" className="text-sm font-bold text-slate-600">{phoneMessage}</p>}

        <div className="border-t border-slate-200 pt-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-black text-slate-800 text-base sm:text-lg">Alexa</div>
              <div className="text-sm font-bold text-slate-600">
                {alexa === null
                  ? 'Not configured'
                  : alexa.configured
                    ? `Voice Monkey ready · ${alexa.source === 'secret-manager' ? 'Secret Manager' : 'environment'}`
                    : 'Voice Monkey not ready'}
              </div>
            </div>
            <label className="flex items-center gap-2 font-black text-slate-700">
              <span>Enabled</span>
              <input type="checkbox" checked={alexaEnabled} onChange={event => setAlexaEnabled(event.target.checked)} className="w-6 h-6 accent-indigo-700" />
            </label>
          </div>

          <label className="block">
            <span className="block text-sm font-black text-slate-700">Device / monkey</span>
            <input
              type="text"
              autoComplete="off"
              value={alexaDevice}
              onChange={event => setAlexaDevice(event.target.value)}
              placeholder="e.g. hot-tub"
              className="mt-1 w-full min-h-12 rounded-xl bg-slate-100 px-3 font-bold text-slate-950"
            />
          </label>

          <label className="block">
            <span className="block text-sm font-black text-slate-700">Voice Monkey API key</span>
            <input
              type="password"
              autoComplete="new-password"
              value={alexaToken}
              onChange={event => setAlexaToken(event.target.value)}
              placeholder={alexa?.configured ? 'Stored securely - leave blank to keep' : 'Paste API key'}
              className="mt-1 w-full min-h-12 rounded-xl bg-slate-100 px-3 font-bold text-slate-950"
            />
            <span className="mt-1 block text-xs font-bold text-slate-500">Saved server-side in Google Secret Manager; the stored key is never sent back to this page.</span>
          </label>

          <label className="block">
            <span className="block text-sm font-black text-slate-700">Chime <span className="font-bold text-slate-500">(optional)</span></span>
            <input
              type="text"
              autoComplete="off"
              value={alexaChime}
              onChange={event => setAlexaChime(event.target.value)}
              placeholder={alexa?.chimeConfigured ? 'Configured - leave blank to keep' : 'None'}
              className="mt-1 w-full min-h-12 rounded-xl bg-slate-100 px-3 font-bold text-slate-950"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={alexaBusy || !alexaDevice.trim()} onClick={() => void saveAlexa()} className="min-h-12 rounded-xl bg-indigo-700 text-white font-black disabled:opacity-40">
              {alexaBusy ? 'Working…' : 'Save'}
            </button>
            <button type="button" disabled={!alexa?.configured || alexaBusy} onClick={() => void testAlexa()} className="min-h-12 rounded-xl bg-slate-950 text-white font-black disabled:opacity-40">
              Test
            </button>
          </div>

          {alexa?.storageError && <p role="alert" className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-bold text-amber-950">Secret Manager: {alexa.storageError}</p>}
          {alexaMessage && <p role="status" className="text-sm font-bold text-slate-600">{alexaMessage}</p>}
        </div>
      </section>

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
    </>
  );
}
