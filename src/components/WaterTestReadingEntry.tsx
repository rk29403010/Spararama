import React, { useMemo, useState } from 'react';
import { HelpCircle, Minus, Plus } from 'lucide-react';
import type { MeasurementKey, MeasurementReading, TestMethodProfile } from '../domain/models';

interface WaterTestReadingEntryProps {
  method: TestMethodProfile;
  onSubmit: (readings: MeasurementReading[]) => void;
}

interface SwatchValue {
  label: string;
  min: number;
  max: number;
  color: string;
}

type StripSelection =
  | { kind: 'swatch'; index: number }
  | { kind: 'between'; leftIndex: number }
  | { kind: 'unknown' };

interface SliderDefinition {
  min: number;
  max: number;
  step: number;
  initial: number;
  unit: string;
}

const swatch = (label: string, value: number, color: string): SwatchValue => ({ label, min: value, max: value, color });
const rangeSwatch = (label: string, min: number, max: number, color: string): SwatchValue => ({ label, min, max, color });

// Approximate screen colours transcribed from the user's bottle charts.
// They are deliberately NOT calibration data: the bottle remains the colour reference.
const STRIP_SCALES: Record<string, Partial<Record<MeasurementKey, SwatchValue[]>>> = {
  'current-3-way': {
    free_chlorine: [
      swatch('0', 0, '#f4f1d2'), swatch('1', 1, '#eeeeea'), swatch('2', 2, '#deddea'),
      swatch('3', 3, '#c8bfdd'), swatch('5', 5, '#ab95ce'), swatch('10', 10, '#8067af')
    ],
    ph: [
      swatch('6.4', 6.4, '#d6b45f'), swatch('6.8', 6.8, '#dca44e'), swatch('7.2', 7.2, '#d99558'),
      swatch('7.6', 7.6, '#cf8069'), swatch('7.8', 7.8, '#cd6f60'), swatch('8.4', 8.4, '#c3526d')
    ],
    total_alkalinity: [
      swatch('0', 0, '#b47e33'), swatch('40', 40, '#697730'), swatch('80', 80, '#465f25'),
      swatch('120', 120, '#355126'), swatch('180', 180, '#1d6971'), swatch('240', 240, '#174c65')
    ]
  },
  'current-7-way': {
    free_chlorine: [
      swatch('0', 0, '#f4faf4'), swatch('0.5', 0.5, '#e2efe7'), swatch('1', 1, '#b9ddd3'),
      swatch('3', 3, '#76c0be'), swatch('5', 5, '#3b929d'), swatch('10', 10, '#195463')
    ],
    ph: [
      swatch('6.2', 6.2, '#f1d488'), swatch('6.8', 6.8, '#efa05a'), swatch('7.2', 7.2, '#ef5d58'),
      swatch('7.6', 7.6, '#eb315a'), swatch('8.4', 8.4, '#be3158'), swatch('9.0', 9, '#94194e')
    ],
    total_alkalinity: [
      swatch('0', 0, '#efb367'), swatch('40', 40, '#c69a61'), swatch('80', 80, '#a49d70'),
      swatch('120', 120, '#849148'), swatch('180', 180, '#4e7c78'), swatch('240', 240, '#33475b')
    ],
    total_chlorine: [
      swatch('0', 0, '#efedef'), swatch('0.5', 0.5, '#e99db4'), swatch('1', 1, '#ed5d88'),
      swatch('3', 3, '#dd316c'), swatch('5', 5, '#d31f54'), swatch('10', 10, '#4b1d31')
    ],
    calcium_hardness: [
      swatch('0', 0, '#79c4d8'), swatch('50', 50, '#70a8c5'), swatch('100', 100, '#7666a5'),
      swatch('250', 250, '#6a4087'), swatch('500', 500, '#743471'), swatch('1000', 1000, '#551d52')
    ],
    cyanuric_acid: [
      swatch('0', 0, '#e6db70'), rangeSwatch('30/50', 30, 50, '#f1b18d'), swatch('100', 100, '#e97f80'),
      swatch('150', 150, '#d84978'), swatch('240', 240, '#9d2758')
    ]
  }
};

const ELECTRONIC_SLIDERS: Record<MeasurementKey, SliderDefinition> = {
  free_chlorine: { min: 0, max: 20, step: 0.1, initial: 3, unit: 'ppm' },
  total_chlorine: { min: 0, max: 20, step: 0.1, initial: 3, unit: 'ppm' },
  bromine: { min: 0, max: 20, step: 0.1, initial: 4, unit: 'ppm' },
  ph: { min: 5.5, max: 9.5, step: 0.01, initial: 7.4, unit: 'pH' },
  total_alkalinity: { min: 0, max: 300, step: 1, initial: 80, unit: 'ppm' },
  calcium_hardness: { min: 0, max: 1000, step: 10, initial: 250, unit: 'ppm' },
  cyanuric_acid: { min: 0, max: 300, step: 1, initial: 30, unit: 'ppm' }
};

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatBetween(left: SwatchValue, right: SwatchValue) {
  return `${formatNumber(left.max)}–${formatNumber(right.min)}`;
}

function stripSelectionLabel(scale: SwatchValue[], selection?: StripSelection) {
  if (!selection) return 'Not set';
  if (selection.kind === 'unknown') return "Don't know";
  if (selection.kind === 'swatch') return scale[selection.index]?.label ?? 'Not set';
  const left = scale[selection.leftIndex];
  const right = scale[selection.leftIndex + 1];
  return left && right ? formatBetween(left, right) : 'Not set';
}

function selectionToReading(measurement: MeasurementKey, scale: SwatchValue[], selection: StripSelection): MeasurementReading | null {
  if (selection.kind === 'unknown') {
    return { measurement, source: 'manual', note: "User selected don't know / no matching colour swatch." };
  }

  if (selection.kind === 'swatch') {
    const chosen = scale[selection.index];
    if (!chosen) return null;
    if (chosen.min === chosen.max) {
      return { measurement, value: chosen.min, source: 'manual', note: `Selected bottle swatch ${chosen.label}.` };
    }
    return { measurement, min: chosen.min, max: chosen.max, source: 'manual', note: `Selected bottle swatch ${chosen.label}.` };
  }

  const left = scale[selection.leftIndex];
  const right = scale[selection.leftIndex + 1];
  if (!left || !right) return null;
  return {
    measurement,
    min: Math.min(left.max, right.min),
    max: Math.max(left.max, right.min),
    source: 'manual',
    note: `Colour judged between bottle swatches ${left.label} and ${right.label}.`
  };
}

function SwatchReadingRow({ label, measurement, scale, selection, onSelect }: {
  label: string;
  measurement: MeasurementKey;
  scale: SwatchValue[];
  selection?: StripSelection;
  onSelect: (selection: StripSelection) => void;
}) {
  const selectedLabel = stripSelectionLabel(scale, selection);

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h5 className="min-w-0 font-black text-lg text-slate-950">{label}</h5>
        <span className={`shrink-0 rounded-xl px-3 py-1.5 text-base font-black tabular-nums ${selection?.kind === 'unknown' ? 'bg-amber-100 text-amber-950' : selection ? 'bg-indigo-100 text-indigo-950' : 'bg-slate-100 text-slate-600'}`}>
          {selectedLabel}
        </span>
      </div>

      <div className="overflow-x-auto overscroll-x-contain pb-2 -mx-1 px-1">
        <div className="min-w-max flex items-start justify-start">
          {scale.map((item, index) => {
            const exactSelected = selection?.kind === 'swatch' && selection.index === index;
            const betweenSelected = selection?.kind === 'between' && selection.leftIndex === index;
            return (
              <React.Fragment key={`${measurement}-${item.label}`}>
                <button
                  type="button"
                  aria-label={`${label} ${item.label}`}
                  aria-pressed={exactSelected}
                  onClick={() => onSelect({ kind: 'swatch', index })}
                  className="group w-14 min-h-[4.75rem] flex flex-col items-center justify-start gap-1.5 pt-1"
                >
                  <span
                    className={`block w-11 h-11 rounded-lg border shadow-sm transition-transform ${exactSelected ? 'ring-4 ring-indigo-600 ring-offset-2 border-white scale-105' : 'border-slate-300 group-active:scale-95'}`}
                    style={{ backgroundColor: item.color }}
                  />
                  <span className={`text-sm leading-none font-black ${exactSelected ? 'text-indigo-900' : 'text-slate-800'}`}>{item.label}</span>
                </button>

                {index < scale.length - 1 && (
                  <button
                    type="button"
                    aria-label={`${label} between ${item.label} and ${scale[index + 1].label}`}
                    aria-pressed={betweenSelected}
                    onClick={() => onSelect({ kind: 'between', leftIndex: index })}
                    className="w-10 min-h-[4.75rem] flex items-start justify-center pt-1"
                  >
                    <span className={`block mt-1 rounded-full ${betweenSelected ? 'w-4 h-10 bg-indigo-700 ring-2 ring-indigo-200' : 'w-2 h-9 bg-slate-200'}`} />
                  </button>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        aria-pressed={selection?.kind === 'unknown'}
        onClick={() => onSelect({ kind: 'unknown' })}
        className={`mt-2 w-full min-h-12 rounded-xl border-2 flex items-center justify-center gap-2 text-sm font-extrabold ${selection?.kind === 'unknown' ? 'border-amber-400 bg-amber-50 text-amber-950' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
      >
        <HelpCircle className="w-5 h-5" aria-hidden="true" />
        Don&apos;t know / no colour matches
      </button>
    </section>
  );
}

function ElectronicSliderRow({ label, measurement, value, onChange, onClear }: {
  label: string;
  measurement: MeasurementKey;
  value?: number;
  onChange: (value: number) => void;
  onClear: () => void;
}) {
  const definition = ELECTRONIC_SLIDERS[measurement];
  const sliderValue = value ?? definition.initial;
  const active = typeof value === 'number';

  const nudge = (direction: -1 | 1) => {
    const next = Math.min(definition.max, Math.max(definition.min, sliderValue + definition.step * direction));
    onChange(Number(next.toFixed(4)));
  };

  return (
    <section className={`rounded-2xl border-2 p-4 transition-colors ${active ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h5 className="font-black text-lg text-slate-950">{label}</h5>
          <p className="text-sm font-bold text-slate-500">{definition.min}–{definition.max} {definition.unit}</p>
        </div>
        <span className={`rounded-xl px-3 py-1.5 text-base font-black tabular-nums ${active ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
          {active ? `${formatNumber(value)} ${definition.unit}` : 'Not set'}
        </span>
      </div>

      <input
        type="range"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={sliderValue}
        aria-label={label}
        onPointerDown={() => { if (!active) onChange(sliderValue); }}
        onChange={event => onChange(Number(event.target.value))}
        className={`w-full mt-5 accent-indigo-700 ${active ? '' : 'opacity-45'}`}
      />

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => nudge(-1)} className="w-14 h-14 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 flex items-center justify-center" aria-label={`Decrease ${label}`}>
          <Minus className="w-6 h-6" aria-hidden="true" />
        </button>
        <div className="flex-1 text-center text-3xl font-black tabular-nums text-slate-950">
          {active ? formatNumber(value) : '—'}
        </div>
        <button type="button" onClick={() => nudge(1)} className="w-14 h-14 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 flex items-center justify-center" aria-label={`Increase ${label}`}>
          <Plus className="w-6 h-6" aria-hidden="true" />
        </button>
      </div>

      {active && (
        <button type="button" onClick={onClear} className="w-full mt-2 min-h-11 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100">
          Clear reading
        </button>
      )}
    </section>
  );
}

export function WaterTestReadingEntry({ method, onSubmit }: WaterTestReadingEntryProps) {
  const electronic = method.id === 'electronic';
  const scales = STRIP_SCALES[method.id] ?? {};
  const [stripSelections, setStripSelections] = useState<Partial<Record<MeasurementKey, StripSelection>>>({});
  const [electronicValues, setElectronicValues] = useState<Partial<Record<MeasurementKey, number>>>({});
  const [error, setError] = useState('');

  const selectedCount = useMemo(() => {
    if (electronic) return Object.values(electronicValues).filter(value => typeof value === 'number').length;
    return Object.keys(stripSelections).length;
  }, [electronic, electronicValues, stripSelections]);

  const submit = () => {
    let readings: MeasurementReading[];

    if (electronic) {
      readings = method.parameters
        .map(parameter => {
          const value = electronicValues[parameter.measurement];
          if (typeof value !== 'number') return null;
          return { measurement: parameter.measurement, value, source: 'manual' as const, note: 'Manually entered from electronic tester.' };
        })
        .filter((reading): reading is MeasurementReading => Boolean(reading));
    } else {
      readings = method.parameters
        .map(parameter => {
          const scale = scales[parameter.measurement];
          const selection = stripSelections[parameter.measurement];
          if (!scale || !selection) return null;
          return selectionToReading(parameter.measurement, scale, selection);
        })
        .filter((reading): reading is MeasurementReading => Boolean(reading));
    }

    if (readings.length === 0) {
      setError(electronic ? 'Set at least one reading.' : 'Choose at least one result, even if it is Don\'t know.');
      return;
    }

    setError('');
    onSubmit(readings);
  };

  if (electronic) {
    return (
      <div className="space-y-4">
        <h4 className="text-xl font-black text-slate-950">Tester readings</h4>
        <div className="space-y-3">
          {method.parameters.map(parameter => (
            <ElectronicSliderRow
              key={parameter.measurement}
              label={parameter.label}
              measurement={parameter.measurement}
              value={electronicValues[parameter.measurement]}
              onChange={value => setElectronicValues(current => ({ ...current, [parameter.measurement]: value }))}
              onClear={() => setElectronicValues(current => {
                const next = { ...current };
                delete next[parameter.measurement];
                return next;
              })}
            />
          ))}
        </div>
        {error && <div aria-live="polite" className="rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 p-4 font-bold">{error}</div>}
        <button type="button" onClick={submit} className="w-full min-h-16 rounded-2xl bg-indigo-700 hover:bg-indigo-800 active:bg-indigo-900 text-white text-xl font-black">
          Save readings{selectedCount ? ` (${selectedCount})` : ''}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xl font-black text-slate-950">Match the strip</h4>
        <p className="mt-1 text-sm font-bold text-slate-600">Compare with the bottle - screen colours are approximate. Tap a colour or the gap between two.</p>
      </div>

      <div className="space-y-3">
        {method.parameters.map(parameter => {
          const scale = scales[parameter.measurement];
          if (!scale) return null;
          return (
            <SwatchReadingRow
              key={parameter.measurement}
              label={parameter.label}
              measurement={parameter.measurement}
              scale={scale}
              selection={stripSelections[parameter.measurement]}
              onSelect={selection => setStripSelections(current => ({ ...current, [parameter.measurement]: selection }))}
            />
          );
        })}
      </div>

      {error && <div aria-live="polite" className="rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 p-4 font-bold">{error}</div>}
      <button type="button" onClick={submit} className="w-full min-h-16 rounded-2xl bg-indigo-700 hover:bg-indigo-800 active:bg-indigo-900 text-white text-xl font-black">
        Save readings{selectedCount ? ` (${selectedCount})` : ''}
      </button>
    </div>
  );
}
