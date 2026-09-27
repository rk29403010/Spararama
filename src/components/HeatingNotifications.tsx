import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { auth } from '../lib/firebase';
import { heatingApi, type HeatingNotificationDto } from '../lib/heatingApi';
import { listActiveNotifications, type SpararamaNotificationDto } from '../lib/notificationsApi';
import {
  subscribeToForegroundPush,
  syncPushRegistration,
  type ForegroundPushMessage
} from '../lib/pushNotifications';
import { InAppNotice, ModalBackdrop } from './OverlaySurface';

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
  const dismissedManual = useRef(new Set<string>());
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

        const genericItem = generic.notifications.find(item =>
          !item.deliverySuppressed
          && !item.group.startsWith('heating.')
          && !foregroundPushIds.current.has(item.id)
          && !dismissedGeneric.current.has(`${item.id}:${item.updatedAt}`)
        );
        setGenericNotice(genericItem || null);

        const manual = notifications.find(item =>
          item.kind === 'manual_start_required'
          && !dismissedManual.current.has(item.id)
        );
        setManualPrompt(manual || null);

        for (const item of notifications) {
          if (seen.current.has(item.id) || item.deliveredAt) continue;
          seen.current.add(item.id);
          const copy = alertCopy(item);
          signalForegroundAlert(item.kind);
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

  const dismissManual = () => {
    if (manualPrompt) dismissedManual.current.add(manualPrompt.id);
    setManualPrompt(null);
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
      <InAppNotice
        role="alert"
        severity="warning"
        title="Push notifications need attention"
        message={pushProblem}
        onDismiss={dismissPushProblem}
      />
    )}

    {genericNotice && (
      <InAppNotice
        role="alert"
        severity={genericNotice.severity}
        title={genericNotice.title}
        message={genericNotice.message}
        onDismiss={dismissGeneric}
      />
    )}

    {notice && (
      <InAppNotice
        title={notice.title}
        message={notice.message}
        onDismiss={() => setNotice(null)}
      />
    )}

    {foregroundPush && (
      <InAppNotice
        placement="bottom"
        severity={foregroundPush.severity}
        eyebrow={foregroundPush.kind === 'system.push_test' ? 'Push test received' : 'Notification'}
        title={foregroundPush.title}
        message={foregroundPush.body}
        onDismiss={dismissForegroundPush}
      />
    )}

    {manualPrompt && (
      <ModalBackdrop onDismiss={dismissManual}>
        <div className="relative mx-auto w-full max-w-sm rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
          <button type="button" aria-label="Close message" onClick={dismissManual} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><Bell className="h-6 w-6" aria-hidden="true" /></div>
          <h2 className="pr-12 text-3xl font-black text-slate-950">{manualPrompt.title}</h2>
          <p className="mt-2 break-words text-base font-bold text-slate-600">{manualPrompt.message}</p>
          <button type="button" disabled={busy} onClick={() => void confirmManual()} className="mt-6 flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-700 text-lg font-black text-white disabled:opacity-50">
            <Check className="h-6 w-6" aria-hidden="true" />{busy ? 'Recording…' : 'Heater is on'}
          </button>
        </div>
      </ModalBackdrop>
    )}
  </>;
}
