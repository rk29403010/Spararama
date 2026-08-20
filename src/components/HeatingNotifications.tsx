import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { heatingApi, type HeatingNotificationDto } from '../lib/heatingApi';
import { syncPushRegistration } from '../lib/pushNotifications';

export function HeatingNotifications() {
  const [manualPrompt, setManualPrompt] = useState<HeatingNotificationDto | null>(null);
  const [notice, setNotice] = useState<HeatingNotificationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());
  const pushSynced = useRef(false);

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
          if (!item.pushSentAt && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(item.title, { body: item.message, tag: `spararama-${item.id}` });
          }
          await heatingApi.markDelivered(item.id);
          if (!item.requiresConfirmation) setNotice(item);
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
        <div className="flex-1 min-w-0"><div className="text-lg font-black">{notice.title}</div><div className="text-sm font-bold text-slate-300 mt-1">{notice.message}</div></div>
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
