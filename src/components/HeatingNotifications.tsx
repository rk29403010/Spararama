import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, TriangleAlert, X } from 'lucide-react';
import { auth } from '../lib/firebase';
import { heatingApi, type HeatingNotificationDto } from '../lib/heatingApi';
import { listActiveNotifications, type SpararamaNotificationDto } from '../lib/notificationsApi';
import {
  subscribeToForegroundPush,
  syncPushRegistration,
  type ForegroundPushMessage
} from '../lib/pushNotifications';

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

function genericAlertClass(severity: SpararamaNotificationDto['severity'] | ForegroundPushMessage['severity']) {
  if (severity === 'urgent') return 'border-rose-300 bg-rose-50 text-rose-950';
  if (severity === 'warning') return 'border-amber-300 bg-amber-50 text-amber-950';
  return 'border-slate-300 bg-white text-slate-950';
}

function foregroundVibration(message: ForegroundPushMessage) {
  if (message.kind === 'heating.heat_soak_complete' || message.kind === 'heat_soak_complete') return [300, 120, 300, 120, 650];
  if (message.kind === 'heating.target_reached' || message.kind === 'target_reached') return [220, 120, 350];
  if (message.kind === 'heating.manual_start_required' || message.kind === 'manual_start_required') return [250, 120, 250, 120, 500];
  if (message.severity === 'urgent') return [250, 120, 250, 120, 500];
  if (message.severity === 'warning') return [220, 120, 350];
  return [160];
}

function foregroundFrequencies(message: ForegroundPushMessage) {
  if (message.kind === 'heating.heat_soak_complete' || message.kind === 'heat_soak_complete') return [784, 988, 1175];
  if (message.kind === 'heating.target_reached' || message.kind === 'target_reached') return [740, 980];
  if (message.kind === 'heating.manual_start_required' || message.kind === 'manual_start_required') return [620, 620, 900];
  if (message.severity === 'urgent') return [620, 620, 900];
  if (message.severity === 'warning') return [740, 980];
  return [880];
}

export function HeatingNotifications() {
  const [manualPrompt, setManualPrompt] = useState<HeatingNotificationDto | null>(null);
  const [notice, setNotice] = useState<HeatingNotificationDto | null>(null);
  const [genericNotice, setGenericNotice] = useState<SpararamaNotificationDto | null>(null);
  const [foregroundPush, setForegroundPush] = useState<ForegroundPushMessage | null>(null);
  const [pushProblem, setPushProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());
  const dismissedGeneric = useRef(new Set<string>());
  const foregroundPushIds = useRef(new Set<string>());
  const foregroundPushTimer = useRef<number | null>(null);
  const pushSynced = useRef(false);
  const pushSyncFailures = useRef(0);
  const dismissedPushProblem = useRef<string | null>(null);
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

  const playFrequencies = (frequencies: number[]) => {
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

  const signalForegroundAlert = (kind: HeatingNotificationDto['kind']) => {
    const vibration = vibrationPattern(kind);
    if (vibration.length && 'vibrate' in navigator) navigator.vibrate(vibration);
    playFrequencies(toneFrequencies(kind));
  };

  const signalForegroundPush = (message: ForegroundPushMessage) => {
    const vibration = foregroundVibration(message);
    if (vibration.length && 'vibrate' in navigator) navigator.vibrate(vibration);
    playFrequencies(foregroundFrequencies(message));
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
    const unsubscribe = subscribeToForegroundPush(message => {
      if (message.notificationId) {
        foregroundPushIds.current.add(message.notificationId);
        // Heating still has a compatibility polling path during this migration.
        // Treat the push as already presented so that path does not immediately
        // show the same non-action notification again.
        seen.current.add(message.notificationId);
      }

      signalForegroundPush(message);
      setForegroundPush(message);
      if (foregroundPushTimer.current !== null) window.clearTimeout(foregroundPushTimer.current);
      if (message.severity !== 'urgent' && !message.requiresConfirmation) {
        foregroundPushTimer.current = window.setTimeout(() => {
          setForegroundPush(current => current?.notificationId === message.notificationId ? null : current);
          foregroundPushTimer.current = null;
        }, message.kind === 'system.push_test' ? 7_000 : 10_000);
      }
    });

    return () => {
      unsubscribe();
      if (foregroundPushTimer.current !== null) window.clearTimeout(foregroundPushTimer.current);
      foregroundPushTimer.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const showPushProblem = (message: string) => {
      if (dismissedPushProblem.current !== message) setPushProblem(message);
    };

    const syncPushIfAllowed = async () => {
      if (
        pushSynced.current
        || !('Notification' in window)
        || Notification.permission !== 'granted'
        || !auth?.currentUser
      ) return;

      try {
        const result = await syncPushRegistration();
        if (cancelled) return;
        if (result.status === 'enabled') {
          pushSynced.current = true;
          pushSyncFailures.current = 0;
          dismissedPushProblem.current = null;
          setPushProblem(null);
        } else {
          pushSyncFailures.current = 0;
          showPushProblem(result.message);
        }
      } catch (error: any) {
        if (!cancelled) {
          const message = error?.message || 'This browser could not register for background notifications.';
          pushSyncFailures.current += 1;
          // A page refresh, backend restart or brief Wi-Fi transition can make a
          // single background sync request fail. Do not cover the UI with a scary
          // banner unless the problem persists across several polling cycles.
          if (pushSyncFailures.current >= 3) showPushProblem(message);
          console.warn(`Spararama push registration failed (${pushSyncFailures.current}): ${message}`);
        }
      }
    };

    const poll = async () => {
      await syncPushIfAllowed();
      try {
        const [{ notifications }, generic] = await Promise.all([
          heatingApi.notifications(),
          listActiveNotifications().catch(() => ({ notifications: [] as SpararamaNotificationDto[] }))
        ]);
        if (cancelled) return;

        // Heating still has its established modal/toast presentation while the
        // migration is in progress. Planned-maintenance incidents stay in history
        // but are not surfaced as foreground alerts. A notification already shown
        // immediately by FCM is also skipped here to avoid a second in-app toast.
        const genericItem = generic.notifications.find(item =>
          !item.deliverySuppressed
          && !item.group.startsWith('heating.')
          && !foregroundPushIds.current.has(item.id)
          && !dismissedGeneric.current.has(`${item.id}:${item.updatedAt}`)
        );
        setGenericNotice(genericItem || null);

        const manual = notifications.find(item => item.kind === 'manual_start_required');
        setManualPrompt(manual || null);

        for (const item of notifications) {
          if (seen.current.has(item.id) || item.deliveredAt) continue;
          seen.current.add(item.id);
          const copy = alertCopy(item);
          signalForegroundAlert(item.kind);
          // Background browser notifications now come only from the unified
          // Push route. Creating a second Notification here caused duplicates
          // when the app happened to be open while FCM also delivered the event.
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

  const dismissPushProblem = () => {
    if (pushProblem) dismissedPushProblem.current = pushProblem;
    setPushProblem(null);
  };

  const dismissGeneric = () => {
    if (!genericNotice) return;
    dismissedGeneric.current.add(`${genericNotice.id}:${genericNotice.updatedAt}`);
    setGenericNotice(null);
  };

  const dismissForegroundPush = () => {
    if (foregroundPushTimer.current !== null) window.clearTimeout(foregroundPushTimer.current);
    foregroundPushTimer.current = null;
    setForegroundPush(null);
  };

  return <>
    {pushProblem && (
      <div role="alert" className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-amber-300 bg-amber-50 text-amber-950 p-4 flex gap-3 shadow-lg">
        <TriangleAlert className="w-6 h-6 text-amber-700 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="font-black">Push notifications need attention</div>
          <div className="text-sm font-bold mt-1 break-words">{pushProblem}</div>
        </div>
        <button type="button" aria-label="Dismiss push notification warning" onClick={dismissPushProblem} className="w-11 h-11 -mt-1 -mr-1 rounded-full hover:bg-black/5 flex items-center justify-center shrink-0"><X className="w-5 h-5" aria-hidden="true" /></button>
      </div>
    )}

    {genericNotice && (
      <div role="alert" className={`fixed top-36 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-lg rounded-2xl border p-4 flex gap-3 shadow-lg ${genericAlertClass(genericNotice.severity)}`}>
        <TriangleAlert className="w-6 h-6 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="font-black">{genericNotice.title}</div>
          {genericNotice.message && <div className="text-sm font-bold mt-1 break-words">{genericNotice.message}</div>}
        </div>
        <button type="button" aria-label="Dismiss notification" onClick={dismissGeneric} className="w-11 h-11 -mt-1 -mr-1 rounded-full hover:bg-black/5 flex items-center justify-center"><X className="w-5 h-5" aria-hidden="true" /></button>
      </div>
    )}

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

    {foregroundPush && (
      <div role="status" className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-lg rounded-2xl border p-4 flex gap-3 shadow-xl ${genericAlertClass(foregroundPush.severity)}`}>
        <Bell className="w-6 h-6 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-black uppercase tracking-wide opacity-70">
            {foregroundPush.kind === 'system.push_test' ? 'Push test received' : 'Push received while Spararama is open'}
          </div>
          <div className="font-black mt-0.5">{foregroundPush.title}</div>
          {foregroundPush.body && <div className="text-sm font-bold mt-1 break-words opacity-80">{foregroundPush.body}</div>}
        </div>
        <button type="button" aria-label="Dismiss foreground push notification" onClick={dismissForegroundPush} className="w-11 h-11 -mt-1 -mr-1 rounded-full hover:bg-black/5 flex items-center justify-center shrink-0"><X className="w-5 h-5" aria-hidden="true" /></button>
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
