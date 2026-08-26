import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { heatingApi, type HeatingNotificationDto } from '../lib/heatingApi';
import { syncPushRegistration } from '../lib/pushNotifications';

function alertCopy(item: HeatingNotificationDto) {
  if (item.kind === 'target_reached') return { title: 'Hot tub temperature reached.', message: '' };
  if (item.kind === 'heat_soak_complete') return { title: 'Your hot tub is ready!', message: '' };
  return { title: item.title, message: item.message };
}

function vibrationPattern(kind: HeatingNotificationDto['kind']) {
  if (kind === 'heat_soak_complete') return [300, 120, 300, 120, 650];
  if (kind === 'target_reached') return [220, 120, 350];
  if (kind === 'manual_start_required') return [250, 120, 250, 120, 500];
  return [];
}

function toneFrequencies(kind: HeatingNotificationDto['kind']) {
  if (kind === 'heat_soak_complete') return [784, 988, 1175];
  if (kind === 'target_reached') return [740, 980];
  if (kind === 'manual_start_required') return [620, 620, 900];
  return [];
}

export function HeatingNotifications() {
  const [manualPrompt, setManualPrompt] = useState<HeatingNotificationDto | null>(null);
  const [notice, setNotice] = useState<HeatingNotificationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());
  const pushSynced = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);

  const armAudio = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext.current = audioContext.current || new AudioContextClass();
      if (audioContext.current.state === 'suspended') void audioContext.current.resume();
    } catch {
      // Vibration and visual notifications remain available without audio.
    }
  };

  const signalForegroundAlert = (kind: HeatingNotificationDto['kind']) => {
    const vibration = vibrationPattern(kind);
    if (vibration.length && 'vibrate' in navigator) navigator.vibrate(vibration);

    const frequencies = toneFrequencies(kind);
    const context = audioContext.current;
    if (!frequencies.length || !context || context.state !== 'running') return;

    try {
      const startAt = context.currentTime + 0.02;
      frequencies.forEach((frequency, index) => {
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
    } catch {
      // The browser may still block audio; the visual alert remains visible.
    }
  };

  useEffect(() => {
    const arm = () => armAudio();
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('keydown', arm, true);
    return () => {
      window.removeEventListener('pointerdown', arm, true);
      window.removeEventListener('keydown', arm, true);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncPushIfAllowed = async () => {
      if (pushSynced.current || !('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        const result = await syncPushRegistration();
        if (!cancelled && result.status === 'enabled') pushSynced.current = true;
      } catch {
        // Polling remains the fallback.
      }
    };

    const poll = async () => {
      await syncPushIfAllowed();
      try {
        const { notifications } = await heatingApi.notifications();
        if (cancelled) return;
        const manual = notifications.find(item => item.kind === 'manual_start_required');
        if (manual) setManualPrompt(manual);

        for (const item of notifications) {
          if (seen.current.has(item.id) || item.deliveredAt) continue;
          seen.current.add(item.id);
          const copy = alertCopy(item);
          signalForegroundAlert(item.kind);
          if (!item.pushSentAt && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(copy.title, { body: copy.message, tag: `spararama-${item.id}` });
          }
          await heatingApi.markDelivered(item.id);
          if (!item.requiresConfirmation) setNotice({ ...item, title: copy.title, message: copy.message });
        }
      } catch {
        // Next poll retries.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const confirmManual = async () => {
    if (!manualPrompt) return;
    setBusy(true);
    try {
      await heatingApi.confirmManualStart(manualPrompt.scheduleId);
      setManualPrompt(null);
    } finally {
      setBusy(false);
    }
  };

  return <>
    {notice && (
      <div role="status" className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-slate-950 text-white p-4 flex gap-3">
        <Bell className="w-6 h-6 text-emerald-300 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-black">{notice.title}</div>
          {notice.message && <div className="text-sm font-bold text-slate-300 mt-1">{notice.message}</div>}
        </div>
        <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)} className="w-11 h-11 -mt-1 -mr-1 rounded-full text-slate-300 hover:bg-white/10 flex items-center justify-center"><X className="w-5 h-5" aria-hidden="true" /></button>
      </div>
    )}

    {manualPrompt && (
      <div className="fixed inset-0 bg-slate-950/70 z-50 flex items-end sm:items-center justify-center sm:p-4 overscroll-contain">
        <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6">
          <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mb-4"><Bell className="w-6 h-6" aria-hidden="true" /></div>
          <h2 className="text-3xl font-black text-slate-950">{manualPrompt.title}</h2>
          <p className="text-base font-bold text-slate-600 mt-2">{manualPrompt.message}</p>
          <button type="button" disabled={busy} onClick={() => void confirmManual()} className="mt-6 w-full min-h-16 rounded-2xl bg-indigo-700 text-white text-lg font-black flex items-center justify-center gap-2 disabled:opacity-50">
            <Check className="w-6 h-6" aria-hidden="true" />{busy ? 'Recording…' : 'Heater is on'}
          </button>
        </div>
      </div>
    )}
  </>;
}
