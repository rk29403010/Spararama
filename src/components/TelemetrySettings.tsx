import React, { useEffect, useState } from 'react';
import { RefreshCw, Volume2 } from 'lucide-react';
import { alertsApi, type AlexaAlertStatus, type AlexaSpeakerDto } from '../lib/alertsApi';

const AIR_HORN_CHIME = 'soundbank://soundlibrary/alarms/air_horns/air_horn_01';
type ChimeChoice = 'none' | 'air-horn' | 'custom';

export function TelemetrySettings() {
  const [alexa, setAlexa] = useState<AlexaAlertStatus | null>(null);
  const [alexaEnabled, setAlexaEnabled] = useState(true);
  const [alexaDevice, setAlexaDevice] = useState('');
  const [alexaToken, setAlexaToken] = useState('');
  const [alexaChimeChoice, setAlexaChimeChoice] = useState<ChimeChoice>('none');
  const [alexaCustomChime, setAlexaCustomChime] = useState('');
  const [alexaSpeakers, setAlexaSpeakers] = useState<AlexaSpeakerDto[]>([]);
  const [speakerBusy, setSpeakerBusy] = useState(false);
  const [alexaBusy, setAlexaBusy] = useState(false);
  const [alexaMessage, setAlexaMessage] = useState<string | null>(null);

  const applyAlexaStatus = (status: AlexaAlertStatus) => {
    setAlexa(status);
    setAlexaEnabled(status.enabled);
    if (status.device) setAlexaDevice(status.device);
    const chime = status.chime || '';
    if (!chime) {
      setAlexaChimeChoice('none');
      setAlexaCustomChime('');
    } else if (chime === AIR_HORN_CHIME) {
      setAlexaChimeChoice('air-horn');
      setAlexaCustomChime('');
    } else {
      setAlexaChimeChoice('custom');
      setAlexaCustomChime(chime);
    }
  };

  useEffect(() => {
    let active = true;
    alertsApi.alexaStatus().then(async status => {
      if (!active) return;
      applyAlexaStatus(status);
      if (!status.tokenConfigured) return;
      try {
        const result = await alertsApi.alexaSpeakers();
        if (active) setAlexaSpeakers(result.speakers);
      } catch {
        // The explicit refresh action reports lookup errors when the user needs them.
      }
    }).catch(error => {
      if (active) setAlexaMessage(error?.message || 'Sign in to configure Alexa announcements.');
    });
    return () => { active = false; };
  }, []);

  const findSpeakers = async () => {
    const candidateToken = alexaToken.trim();
    if (!candidateToken && !alexa?.tokenConfigured) {
      setAlexaMessage('Enter the Voice Monkey API key first.');
      return;
    }
    setSpeakerBusy(true);
    setAlexaMessage(null);
    try {
      const result = await alertsApi.alexaSpeakers(candidateToken || undefined);
      setAlexaSpeakers(result.speakers);
      if (result.speakers.length === 1 && !result.speakers.some(speaker => speaker.id === alexaDevice)) {
        setAlexaDevice(result.speakers[0].id);
      }
      setAlexaMessage(result.speakers.length
        ? `${result.speakers.length} Alexa speaker${result.speakers.length === 1 ? '' : 's'} found.`
        : 'No Alexa speakers found in this Voice Monkey account.');
    } catch (error: any) {
      setAlexaMessage(error?.message || 'Unable to load Alexa speakers.');
    } finally {
      setSpeakerBusy(false);
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
        chime: alexaChimeChoice === 'none'
          ? ''
          : alexaChimeChoice === 'air-horn'
            ? AIR_HORN_CHIME
            : alexaCustomChime.trim()
      });
      applyAlexaStatus(status);
      setAlexaToken('');
      setAlexaMessage('Alexa settings saved securely.');
    } catch (error: any) {
      setAlexaMessage(error?.message || 'Unable to save Alexa settings.');
    } finally {
      setAlexaBusy(false);
    }
  };

  const currentSpeakerMissing = Boolean(alexaDevice && !alexaSpeakers.some(speaker => speaker.id === alexaDevice));
  const speakerNameCounts = new Map<string, number>();
  alexaSpeakers.forEach(speaker => speakerNameCounts.set(speaker.name, (speakerNameCounts.get(speaker.name) || 0) + 1));

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
    <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-5">
      <div className="flex items-start gap-3">
        <Volume2 className="w-6 h-6 text-indigo-700 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <h3 className="text-xl font-black text-slate-950">Alexa setup</h3>
          <p className="text-sm font-bold text-slate-600">Choose the household speaker and Voice Monkey connection. Which notification groups Alexa announces is controlled above under Notifications.</p>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-black text-slate-800 text-base sm:text-lg">Alexa speaker</div>
            <div className="text-sm font-bold text-slate-600">
              {alexa === null
                ? 'Loading settings…'
                : alexa.configured
                  ? (alexaEnabled ? 'Voice announcements on' : 'Voice announcements off')
                  : 'Not set up'}
            </div>
          </div>
          <label className="min-h-12 flex items-center gap-3 font-black text-slate-700 cursor-pointer">
            <span>On</span>
            <input type="checkbox" checked={alexaEnabled} onChange={event => setAlexaEnabled(event.target.checked)} className="w-6 h-6 accent-indigo-700" />
          </label>
        </div>

        <label className="block">
          <span className="block text-sm font-black text-slate-700">Voice Monkey API key</span>
          <div className="mt-1 flex gap-2">
            <input type="password" autoComplete="new-password" value={alexaToken} onChange={event => setAlexaToken(event.target.value)} placeholder={alexa?.tokenConfigured ? 'Stored securely' : 'Paste API key'} className="min-w-0 flex-1 min-h-12 rounded-xl bg-slate-100 px-3 font-bold text-slate-950" />
            <button type="button" disabled={speakerBusy || (!alexaToken.trim() && !alexa?.tokenConfigured)} onClick={() => void findSpeakers()} className="min-h-12 px-3 rounded-xl bg-slate-950 text-white font-black disabled:opacity-40 flex items-center gap-2 shrink-0">
              <RefreshCw className={`w-5 h-5 ${speakerBusy ? 'animate-spin' : ''}`} aria-hidden="true" />{speakerBusy ? 'Loading' : 'Find speakers'}
            </button>
          </div>
        </label>

        <label className="block">
          <span className="block text-sm font-black text-slate-700">Announcement speaker</span>
          <select value={alexaDevice} onChange={event => setAlexaDevice(event.target.value)} disabled={speakerBusy || (!alexaSpeakers.length && !alexaDevice)} className="mt-1 w-full min-h-12 rounded-xl bg-slate-100 px-3 font-bold text-slate-950 disabled:opacity-50">
            <option value="">{speakerBusy ? 'Loading speakers…' : alexaSpeakers.length ? 'Choose a speaker' : 'Find speakers first'}</option>
            {currentSpeakerMissing && <option value={alexaDevice}>Current speaker — not found</option>}
            {alexaSpeakers.map(speaker => (
              <option key={speaker.id} value={speaker.id}>
                {speakerNameCounts.get(speaker.name)! > 1 ? `${speaker.name} (${speaker.id})` : speaker.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-black text-slate-700">Sound before announcement</span>
          <select value={alexaChimeChoice} onChange={event => setAlexaChimeChoice(event.target.value as ChimeChoice)} className="mt-1 w-full min-h-12 rounded-xl bg-slate-100 px-3 font-bold text-slate-950">
            <option value="none">No sound</option>
            <option value="air-horn">Air horn</option>
            <option value="custom">Custom Voice Monkey sound</option>
          </select>
        </label>
        {alexaChimeChoice === 'custom' && (
          <label className="block">
            <span className="block text-sm font-black text-slate-700">Custom sound URL</span>
            <input type="text" autoComplete="off" value={alexaCustomChime} onChange={event => setAlexaCustomChime(event.target.value)} placeholder="soundbank://…" className="mt-1 w-full min-h-12 rounded-xl bg-slate-100 px-3 font-bold text-slate-950" />
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={alexaBusy || (alexaEnabled && !alexaDevice.trim()) || (alexaChimeChoice === 'custom' && !alexaCustomChime.trim())} onClick={() => void saveAlexa()} className="min-h-12 rounded-xl bg-indigo-700 text-white font-black disabled:opacity-40">{alexaBusy ? 'Working…' : 'Save Alexa'}</button>
          <button type="button" disabled={!alexa?.configured || !alexaEnabled || alexaBusy} onClick={() => void testAlexa()} className="min-h-12 rounded-xl bg-slate-950 text-white font-black disabled:opacity-40">Send test</button>
        </div>

        {alexa?.storageError && <p role="alert" className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-bold text-amber-950">Secure storage: {alexa.storageError}</p>}
        {alexaMessage && <p role="status" className="text-sm font-bold text-slate-600">{alexaMessage}</p>}
      </div>
    </section>
  );
}
