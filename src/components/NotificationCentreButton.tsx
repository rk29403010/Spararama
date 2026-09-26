import React, { useEffect, useMemo, useState } from 'react';
import { Bell, Settings, X } from 'lucide-react';
import { listActiveNotifications, type SpararamaNotificationDto } from '../lib/notificationsApi';

function ageText(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(timestamp).toLocaleString();
}

function severityClasses(severity: SpararamaNotificationDto['severity']) {
  if (severity === 'urgent') return 'border-rose-200 bg-rose-50 text-rose-950';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-950';
  return 'border-slate-200 bg-slate-50 text-slate-950';
}

export function NotificationCentreButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [notifications, setNotifications] = useState<SpararamaNotificationDto[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await listActiveNotifications();
        if (!cancelled) {
          setNotifications(result.notifications.filter(item => !item.deliverySuppressed));
          setError('');
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load notifications.');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const urgentCount = useMemo(() => notifications.filter(item => item.severity === 'urgent').length, [notifications]);
  const count = notifications.length;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={count ? `${count} active notification${count === 1 ? '' : 's'}` : 'Notifications'}
        title="Notifications"
        onClick={() => setOpen(value => !value)}
        className={`relative w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${open ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}`}
      >
        <Bell className="w-5 h-5" aria-hidden="true" />
        {count > 0 && (
          <span className={`absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full text-[11px] leading-5 text-center font-black text-white ${urgentCount ? 'bg-rose-700' : 'bg-indigo-700'}`}>
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <div className="font-black text-slate-950">Notifications</div>
              <div className="text-xs font-bold text-slate-500">{count ? `${count} active` : 'Nothing needs attention'}</div>
            </div>
            <button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className="w-10 h-10 rounded-xl text-slate-600 hover:bg-slate-100 flex items-center justify-center"><X className="w-5 h-5" aria-hidden="true" /></button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
            {error && <div className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900">{error}</div>}
            {!error && notifications.length === 0 && <div className="py-6 text-center text-sm font-bold text-slate-500">No active notifications.</div>}
            {notifications.slice(0, 8).map(item => (
              <div key={item.id} className={`rounded-xl border p-3 ${severityClasses(item.severity)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="font-black">{item.title}</div>
                  <div className="text-[11px] font-black uppercase shrink-0">{item.severity}</div>
                </div>
                {item.message && <div className="text-sm font-bold opacity-80 mt-1">{item.message}</div>}
                <div className="text-xs font-bold opacity-60 mt-2">{ageText(item.createdAt)}</div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => { setOpen(false); onOpenSettings(); }}
              className="w-full min-h-11 rounded-xl bg-slate-100 text-slate-900 font-black flex items-center justify-center gap-2"
            >
              <Settings className="w-4 h-4" aria-hidden="true" />Notification settings & history
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
