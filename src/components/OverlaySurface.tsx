import React from 'react';
import { Bell, TriangleAlert, X } from 'lucide-react';

export type NoticeSeverity = 'info' | 'warning' | 'urgent';

function noticeClasses(severity: NoticeSeverity) {
  if (severity === 'urgent') return 'border-rose-300 bg-rose-50 text-rose-950';
  if (severity === 'warning') return 'border-amber-300 bg-amber-50 text-amber-950';
  return 'border-slate-300 bg-white text-slate-950';
}

export function InAppNotice({
  title,
  message,
  eyebrow,
  severity = 'info',
  placement = 'top',
  onDismiss,
  role = 'status'
}: {
  title: string;
  message?: string | null;
  eyebrow?: string | null;
  severity?: NoticeSeverity;
  placement?: 'top' | 'bottom';
  onDismiss: () => void;
  role?: 'status' | 'alert';
}) {
  const Icon = severity === 'info' ? Bell : TriangleAlert;
  const positionClass = placement === 'bottom'
    ? 'bottom-[calc(env(safe-area-inset-bottom)+6rem)]'
    : 'top-[calc(env(safe-area-inset-top)+5rem)]';

  return (
    <div
      className={`fixed inset-x-0 z-40 pointer-events-none ${positionClass}`}
      style={{
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right))'
      }}
    >
      <div
        role={role}
        className={`pointer-events-auto mx-auto w-full max-w-lg overflow-hidden rounded-2xl border p-4 shadow-xl ${noticeClasses(severity)}`}
        onClick={onDismiss}
      >
        <div className="flex min-w-0 items-start gap-3">
          <Icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="text-xs font-black uppercase tracking-wide opacity-65">{eyebrow}</div>}
            <div className="break-words text-base font-black leading-snug">{title}</div>
            {message && <div className="mt-1 break-words text-sm font-bold leading-snug opacity-80">{message}</div>}
          </div>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={event => { event.stopPropagation(); onDismiss(); }}
            className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModalBackdrop({
  children,
  onDismiss,
  align = 'end'
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  align?: 'end' | 'center';
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-slate-950/70 overscroll-contain ${align === 'center' ? 'items-center' : 'items-end sm:items-center'}`}
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="w-full sm:px-4" onClick={event => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
