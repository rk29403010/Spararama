import React, { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
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

// Approximate screen colours only. The bottle remains the colour reference.
// The 7-way values below are transcribed from the user's reference chart; that
// chart is not the exact strip model, so these are deliberately provisional.
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
    total_chlorine: [
      swatch('0', 0, '#f5f4f5'), swatch('0.25', 0.25, '#e7b6df'), swatch('0.5', 0.5, '#cf96c3'),
      swatch('1', 1, '#a86e9f'), swatch('2.5', 2.5, '#7d4778'), swatch('5', 5, '#53234d')
    ],
    free_chlorine: [
      swatch('0', 0, '#f6f6f1'), swatch('0.5/1', 0.5, '#dcebf0'), swatch('1/2', 1, '#b8dde7'),
      swatch('3/6', 3, '#70c0d7'), swatch('5/11', 5, '#3196b7'), swatch('10/22', 10, '#17667d')
    ],
    ph: [
      swatch('6.2', 6.2, '#f0c463'), swatch('6.8', 6.8, '#f3a16a'), swatch('7.2', 7.2, '#ef836f'),
      swatch('7.6', 7.6, '#eb6576'), swatch('7.8', 7.8, '#e6507c'), swatch('8.4', 8.4, '#d43f83')
    ],
    total_alkalinity: [
      swatch('0', 0, '#efc74e'), swatch('40', 40, '#d6c66f'), swatch('80', 80, '#a5b37c'),
      swatch('120', 120, '#7ea397'), swatch('180', 180, '#57869d'), swatch('240', 240, '#376fa8'),
      swatch('400', 400, '#2476b8')
    ],
    calcium_hardness: [
      swatch('0', 0, '#65b9dc'), swatch('100', 100, '#78add4'), swatch('250', 250, '#9291d8'),
      swatch('500', 500, '#8076c7'), swatch('1000', 1000, '#6658ad')
    ],
    cyanuric_acid: [
      swatch('0', 0, '#bf2758'), rangeSwatch('30–50', 30, 50, '#ca4459'), swatch('100', 100, '#d47b5d'),
      swatch('150', 150, '#d49b52'), swatch('240', 240, '#c7a347')
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
  return (
    <section className="flex min-h-14 items-center gap-1.5 py-1.5">
      <button
        type="button"
        aria-label={`${label}: no matching colour`}
        aria-pressed={selection?.kind === 'unknown'}
        onClick={() => onSelect({ kind: 'unknown' })}
        className={`w-[5.25rem] shrink-0 rounded-lg px-1.5 py-1 text-left leading-tight ${selection?.kind === 'unknown' ? 'bg-amber-100 text-amber-950 ring-2 ring-amber-400' : 'bg-white text-slate-950'}`}
      >
        <span className="block text-sm font-black">{label}</span>
        <span className={`block text-[10px] font-bold ${selection?.kind === 'unknown' ? 'text-amber-800' : 'text-slate-500'}`}>No match</span>
      </button>

      <div className="flex min-w-0 flex-1 items-start" role="group" aria-label={`${label} colour choices`}>
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
                className="group min-w-0 flex-1 px-px text-center"
              >
                <span
                  className={`mx-auto block aspect-square w-full max-w-8 rounded-md border shadow-sm ${exactSelected ? 'border-white ring-3 ring-indigo-700 ring-offset-1' : 'border-slate-300 group-active:ring-2 group-active:ring-slate-400'}`}
                  style={{ backgroundColor: item.color }}
                />
                <span className={`mt-0.5 block whitespace-nowrap text-[10px] font-black leading-none tabular-nums ${exactSelected ? 'text-indigo-900' : 'text-slate-800'}`}>{item.label}</span>
              </button>

              {index < scale.length - 1 && (
                <button
                  type="button"
                  aria-label={`${label} between ${item.label} and ${scale[index + 1].label}`}
                  aria-pressed={betweenSelected}
                  onClick={() => onSelect({ kind: 'between', leftIndex: index })}
                  className="relative min-h-11 w-3 shrink-0 bg-white"
                >
                  <span className="absolute inset-y-0 -left-1 -right-1" aria-hidden="true" />
                  {betweenSelected && <span className="absolute inset-x-0 bottom-2 h-1 rounded-full bg-indigo-700" aria-hidden="true" />}
                </button>
              )}
            </React.Fragment>
          );
        })}
      </div>
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
      setError(electronic ? 'Set at least one reading.' : 'Choose at least one result or No match.');
      return;
    }

    setError('');
    onSubmit(readings);
  };

  if (electronic) {
    return (
      <div className="space-y-4">
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
        {error && <div aria-live="polite" className="rounded-xl bg-amber-50 border border-amber-200 text-amber-950 px-3 py-2 font-bold">{error}</div>}
        <button type="button" onClick={submit} className="w-full min-h-14 rounded-2xl bg-indigo-700 hover:bg-indigo-800 active:bg-indigo-900 text-white text-lg font-black">
          Save readings{selectedCount ? ` (${selectedCount})` : ''}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-2">
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

      {error && <div aria-live="polite" className="rounded-xl bg-amber-50 border border-amber-200 text-amber-950 px-3 py-2 text-sm font-bold">{error}</div>}
      <button type="button" onClick={submit} className="w-full min-h-12 shrink-0 rounded-xl bg-indigo-700 hover:bg-indigo-800 active:bg-indigo-900 text-white text-lg font-black">
        Save readings{selectedCount ? ` (${selectedCount})` : ''}
      </button>
    </div>
  );
}