import React, { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { MeasurementKey, MeasurementReading, TestMethodProfile } from '../domain/models';
import { canIgnoreImpossibleTotalChlorineZero, ignoreImpossibleTotalChlorineZero } from '../domain/chemistry';
import { SEVEN_WAY_NOTE_MARKER, STRIP_SCALES, type StripSwatchValue } from '../domain/stripScales';

interface WaterTestReadingEntryProps {
  method: TestMethodProfile;
  onSubmit: (readings: MeasurementReading[]) => void;
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

const ELECTRONIC_SLIDERS: Record<MeasurementKey, SliderDefinition> = {
  free_chlorine: { min: 0, max: 20, step: 0.1, initial: 3, unit: 'ppm' },
  total_chlorine: { min: 0, max: 20, step: 0.1, initial: 3, unit: 'ppm' },
  bromine: { min: 0, max: 25, step: 0.1, initial: 4, unit: 'ppm' },
  ph: { min: 5.5, max: 9.5, step: 0.01, initial: 7.4, unit: 'pH' },
  total_alkalinity: { min: 0, max: 300, step: 1, initial: 80, unit: 'ppm' },
  calcium_hardness: { min: 0, max: 1000, step: 10, initial: 250, unit: 'ppm' },
  cyanuric_acid: { min: 0, max: 300, step: 1, initial: 30, unit: 'ppm' }
};

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function selectionToReading(
  methodId: string,
  measurement: MeasurementKey,
  scale: StripSwatchValue[],
  selection: StripSelection
): MeasurementReading | null {
  const revisionMarker = methodId === 'current-7-way' ? ` ${SEVEN_WAY_NOTE_MARKER}` : '';

  if (selection.kind === 'unknown') {
    return {
      measurement,
      source: 'manual',
      note: `User selected don't know / no matching colour swatch.${revisionMarker}`
    };
  }

  if (selection.kind === 'swatch') {
    const chosen = scale[selection.index];
    if (!chosen) return null;
    const note = `Selected bottle swatch ${chosen.label}.${revisionMarker}`;
    if (chosen.min === chosen.max) {
      return { measurement, value: chosen.min, source: 'manual', note };
    }
    return { measurement, min: chosen.min, max: chosen.max, source: 'manual', note };
  }

  const left = scale[selection.leftIndex];
  const right = scale[selection.leftIndex + 1];
  if (!left || !right) return null;
  return {
    measurement,
    min: Math.min(left.max, right.min),
    max: Math.max(left.max, right.min),
    source: 'manual',
    note: `Colour judged between bottle swatches ${left.label} and ${right.label}.${revisionMarker}`
  };
}

function SwatchReadingRow({ label, measurement, scale, selection, onSelect }: {
  label: string;
  measurement: MeasurementKey;
  scale: StripSwatchValue[];
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
  const [ignoreTotalChlorineZero, setIgnoreTotalChlorineZero] = useState(false);
  const [error, setError] = useState('');

  const selectedCount = useMemo(() => {
    if (electronic) return Object.values(electronicValues).filter(value => typeof value === 'number').length;
    return Object.keys(stripSelections).length;
  }, [electronic, electronicValues, stripSelections]);

  const stripReadings = useMemo(() => {
    if (electronic) return [];
    return method.parameters
      .map((parameter): MeasurementReading | null => {
        const scale = scales[parameter.measurement];
        const selection = stripSelections[parameter.measurement];
        if (!scale || !selection) return null;
        return selectionToReading(method.id, parameter.measurement, scale, selection);
      })
      .filter((reading): reading is MeasurementReading => Boolean(reading));
  }, [electronic, method, scales, stripSelections]);

  const canIgnoreTotalChlorineZero = method.id === 'current-7-way'
    && canIgnoreImpossibleTotalChlorineZero(stripReadings);

  const submit = () => {
    let readings: MeasurementReading[];

    if (electronic) {
      readings = method.parameters
        .map((parameter): MeasurementReading | null => {
          const value = electronicValues[parameter.measurement];
          if (typeof value !== 'number') return null;
          return { measurement: parameter.measurement, value, source: 'manual', note: 'Manually entered from electronic tester.' };
        })
        .filter((reading): reading is MeasurementReading => Boolean(reading));
    } else {
      readings = ignoreTotalChlorineZero
        ? ignoreImpossibleTotalChlorineZero(stripReadings)
        : stripReadings;
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
              onSelect={selection => {
                setStripSelections(current => ({ ...current, [parameter.measurement]: selection }));
                if (parameter.measurement === 'free_chlorine' || parameter.measurement === 'total_chlorine') {
                  setIgnoreTotalChlorineZero(false);
                }
              }}
            />
          );
        })}
      </div>

      {canIgnoreTotalChlorineZero && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
          <span className="text-sm font-black leading-tight">TC 0 conflicts with free chlorine.</span>
          <button
            type="button"
            aria-pressed={ignoreTotalChlorineZero}
            onClick={() => setIgnoreTotalChlorineZero(current => !current)}
            className={`min-h-11 shrink-0 rounded-xl px-3 text-sm font-black ${ignoreTotalChlorineZero ? 'bg-amber-900 text-white' : 'bg-white text-amber-950 ring-1 ring-amber-300'}`}
          >
            {ignoreTotalChlorineZero ? 'TC ignored' : 'Ignore TC'}
          </button>
        </div>
      )}

      {error && <div aria-live="polite" className="rounded-xl bg-amber-50 border border-amber-200 text-amber-950 px-3 py-2 text-sm font-bold">{error}</div>}
      <button type="button" onClick={submit} className="w-full min-h-12 shrink-0 rounded-xl bg-indigo-700 hover:bg-indigo-800 active:bg-indigo-900 text-white text-lg font-black">
        Save readings{selectedCount ? ` (${selectedCount})` : ''}
      </button>
    </div>
  );
}
