import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { STRIP_SCALE_ROWS, type StripScaleRow } from '../domain/stripScales';

function ReferenceRow({ row }: { row: StripScaleRow }) {
  return (
    <div className="border-t border-slate-200 first:border-t-0 py-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="font-black text-slate-950">{row.label}{row.unit ? <span className="ml-1 text-xs text-slate-500">({row.unit})</span> : null}</div>
          {row.printedTarget && <div className="text-xs font-bold text-emerald-800">Bottle OK: {row.printedTarget}</div>}
        </div>
      </div>

      <div className="flex min-w-0 items-start gap-1" aria-label={`${row.label} swatches`}>
        {row.swatches.map(item => (
          <div key={`${row.measurement}-${item.label}`} className="min-w-0 flex-1 text-center">
            <span
              className="mx-auto block aspect-square w-full max-w-9 rounded-md border border-slate-300 shadow-sm"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
            <span className="mt-1 block whitespace-nowrap text-[10px] font-black tabular-nums text-slate-800">{item.label}</span>
          </div>
        ))}
      </div>

      {row.targetWarning && (
        <div className="mt-2 flex gap-1.5 text-xs font-bold text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{row.targetWarning}</span>
        </div>
      )}
    </div>
  );
}

function MethodReference({ methodId, title, open = false }: { methodId: string; title: string; open?: boolean }) {
  const rows = STRIP_SCALE_ROWS[methodId] || [];
  return (
    <details open={open} className="rounded-2xl border border-slate-200 bg-slate-50 px-3">
      <summary className="min-h-12 cursor-pointer flex items-center font-black text-slate-900">{title}</summary>
      <div className="pb-2">
        {rows.map(row => <ReferenceRow key={row.measurement} row={row} />)}
      </div>
    </details>
  );
}

export function StripScaleReference() {
  return (
    <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-4" data-no-tab-swipe>
      <div>
        <h3 className="text-xl font-black text-slate-950">Test strip reference</h3>
        <p className="mt-1 text-sm font-bold text-slate-600">The same swatches and values used when recording a test.</p>
      </div>

      <MethodReference methodId="current-3-way" title="3-in-1 strip" />
      <MethodReference methodId="current-7-way" title="7-in-1 strip" open />

      <p className="text-xs font-bold text-slate-500">Screen colours are approximate. Match the wet strip against the bottle; the numeric scale/order is the recorded reference.</p>
    </section>
  );
}
