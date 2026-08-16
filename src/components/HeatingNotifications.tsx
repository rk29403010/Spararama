import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { heatingApi, type HeatingNotificationDto } from '../lib/heatingApi';
import { syncPushRegistration } from '../lib/pushNotifications';

export function HeatingNotifications() {
  const [manualPrompt, setManualPrompt] = useState<HeatingNotificationDto | null>(null);
  const [notice, setNotice] = useState<HeatingNotificationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    // Do not prompt on startup. If this browser was already granted permission,
    // refresh its FCM token/registration so background delivery stays healthy.
    void syncPushRegistration().catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { notifications } = await heatingApi.notifications();
        if (cancelled) return;
        const manual = notifications.find(item => item.kind === 'manual_start_required');
        if (manual) setManualPrompt(manual);

        for (const item of notifications) {
          if (seen.current.has(item.id) || item.deliveredAt) continue;
          seen.current.add(item.id);
          // If FCM already accepted this notification, do not create a second
          // browser Notification while the app is open. The in-app notice/prompt
          // still appears and deliveredAt remains distinct from pushSentAt.
          if (!item.pushSentAt && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(item.title, { body: item.message, tag: `spararama-${item.id}` });
          }
          await heatingApi.markDelivered(item.id);
          if (!item.requiresConfirmation) setNotice(item);
        }
      } catch {
        // Backend notification polling is best effort; the next poll retries.
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
    {notice && <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-slate-900 text-white shadow-xl p-4 flex gap-3">
      <Bell className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
      <div className="flex-1"><div className="font-extrabold">{notice.title}</div><div className="text-sm text-slate-300 mt-1">{notice.message}</div></div>
      <button type="button" onClick={() => setNotice(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
    </div>}

    {manualPrompt && <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl">
        <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mb-4"><Bell className="w-6 h-6" /></div>
        <h2 className="text-xl font-black text-slate-900">{manualPrompt.title}</h2>
        <p className="text-sm text-slate-600 mt-2">{manualPrompt.message}</p>
        <p className="text-xs text-slate-500 mt-4">Confirm only after you have actually switched the heater on. Spararama records the confirmation time for the heating history.</p>
        <button type="button" disabled={busy} onClick={() => void confirmManual()} className="mt-6 w-full min-h-12 rounded-xl bg-indigo-600 text-white font-extrabold flex items-center justify-center gap-2 disabled:opacity-50"><Check className="w-5 h-5" />{busy ? 'Recording…' : 'Heater is on'}</button>
      </div>
    </div>}
  </>;
}
