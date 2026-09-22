import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { applyPwaUpdate, subscribeToPwaUpdates } from '../pwa';

export function PwaUpdatePrompt() {
  const [ready, setReady] = useState(false);

  useEffect(() => subscribeToPwaUpdates(() => setReady(true)), []);
  if (!ready) return null;

  return (
    <aside
      aria-live="polite"
      className="fixed inset-x-3 bottom-24 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-300 bg-white p-3 text-slate-950 shadow-xl"
    >
      <RefreshCw className="h-6 w-6 shrink-0 text-indigo-700" aria-hidden="true" />
      <p className="min-w-0 flex-1 font-black">A Spararama update is ready.</p>
      <button
        type="button"
        className="min-h-12 rounded-xl bg-indigo-700 px-4 font-black text-white"
        onClick={() => applyPwaUpdate()}
      >
        Update
      </button>
      <button
        type="button"
        aria-label="Update later"
        className="flex min-h-12 min-w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700"
        onClick={() => setReady(false)}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </aside>
  );
}
