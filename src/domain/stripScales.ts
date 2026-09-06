import type { MeasurementKey, MeasurementReading } from './models';

export const SEVEN_WAY_SCALE_REVISION = '7way-bottle-2026-09-06';
export const SEVEN_WAY_NOTE_MARKER = '[scale:7way-bottle-2026-09-06]';

export interface StripSwatchValue {
  label: string;
  min: number;
  max: number;
  color: string;
}

export interface StripScaleRow {
  measurement: MeasurementKey;
  label: string;
  unit?: string;
  swatches: StripSwatchValue[];
  printedTarget?: string;
  targetWarning?: string;
}

const swatch = (label: string, value: number, color: string): StripSwatchValue => ({ label, min: value, max: value, color });
const rangeSwatch = (label: string, min: number, max: number, color: string): StripSwatchValue => ({ label, min, max, color });

export const STRIP_SCALE_ROWS: Record<string, StripScaleRow[]> = {
  'current-3-way': [
    {
      measurement: 'free_chlorine', label: 'Free chlorine', unit: 'ppm',
      swatches: [
        swatch('0', 0, '#f4f1d2'), swatch('1', 1, '#eeeeea'), swatch('2', 2, '#deddea'),
        swatch('3', 3, '#c8bfdd'), swatch('5', 5, '#ab95ce'), swatch('10', 10, '#8067af')
      ]
    },
    {
      measurement: 'ph', label: 'pH',
      swatches: [
        swatch('6.4', 6.4, '#d6b45f'), swatch('6.8', 6.8, '#dca44e'), swatch('7.2', 7.2, '#d99558'),
        swatch('7.6', 7.6, '#cf8069'), swatch('7.8', 7.8, '#cd6f60'), swatch('8.4', 8.4, '#c3526d')
      ]
    },
    {
      measurement: 'total_alkalinity', label: 'Total alkalinity', unit: 'ppm',
      swatches: [
        swatch('0', 0, '#b47e33'), swatch('40', 40, '#697730'), swatch('80', 80, '#465f25'),
        swatch('120', 120, '#355126'), swatch('180', 180, '#1d6971'), swatch('240', 240, '#174c65')
      ]
    }
  ],
  'current-7-way': [
    {
      measurement: 'free_chlorine', label: 'Free chlorine', unit: 'ppm', printedTarget: 'Pool 1–3; spa 3–5',
      swatches: [
        swatch('0', 0, '#f6f6f1'), swatch('0.5', 0.5, '#dcebf0'), swatch('1', 1, '#b8dde7'),
        swatch('3', 3, '#70c0d7'), swatch('5', 5, '#3196b7'), swatch('10', 10, '#17667d')
      ]
    },
    {
      measurement: 'ph', label: 'pH', printedTarget: '7.2–7.6',
      swatches: [
        swatch('6.2', 6.2, '#f0c463'), swatch('6.8', 6.8, '#f3a16a'), swatch('7.2', 7.2, '#ef836f'),
        swatch('7.6', 7.6, '#eb6576'), swatch('8.4', 8.4, '#e6507c'), swatch('9.0', 9, '#d43f83')
      ]
    },
    {
      measurement: 'bromine', label: 'Bromine', unit: 'ppm', printedTarget: 'Pool 2–6.6; spa 6.6–11',
      swatches: [
        swatch('0', 0, '#f5f4f5'), swatch('1', 1, '#e7b6df'), swatch('2.0', 2, '#cf96c3'),
        swatch('6.6', 6.6, '#a86e9f'), swatch('11', 11, '#7d4778'), swatch('22', 22, '#53234d')
      ]
    },
    {
      measurement: 'total_alkalinity', label: 'Total alkalinity', unit: 'ppm', printedTarget: '80–120',
      swatches: [
        swatch('0', 0, '#efc74e'), swatch('40', 40, '#d6c66f'), swatch('80', 80, '#a5b37c'),
        swatch('120', 120, '#7ea397'), swatch('180', 180, '#57869d'), swatch('240', 240, '#376fa8')
      ]
    },
    {
      measurement: 'total_chlorine', label: 'Total chlorine', unit: 'ppm', printedTarget: 'Bottle marks 0',
      targetWarning: 'Not used as an app target: total chlorine cannot be 0 when free chlorine is above 0.',
      swatches: [
        swatch('0', 0, '#f5f4f5'), swatch('0.5', 0.5, '#e7b6df'), swatch('1', 1, '#cf96c3'),
        swatch('3', 3, '#a86e9f'), swatch('5', 5, '#7d4778'), swatch('10', 10, '#53234d')
      ]
    },
    {
      measurement: 'calcium_hardness', label: 'Total hardness', unit: 'ppm', printedTarget: '100–500',
      swatches: [
        swatch('0', 0, '#65b9dc'), swatch('50', 50, '#70b4d8'), swatch('100', 100, '#78add4'),
        swatch('250', 250, '#9291d8'), swatch('500', 500, '#8076c7'), swatch('1000', 1000, '#6658ad')
      ]
    },
    {
      measurement: 'cyanuric_acid', label: 'Cyanuric acid', unit: 'ppm', printedTarget: '30–50',
      swatches: [
        swatch('0', 0, '#bf2758'), rangeSwatch('30–50', 30, 50, '#ca4459'), swatch('100', 100, '#d47b5d'),
        swatch('150', 150, '#d49b52'), swatch('240', 240, '#c7a347')
      ]
    }
  ]
};

export const STRIP_SCALES: Record<string, Partial<Record<MeasurementKey, StripSwatchValue[]>>> = Object.fromEntries(
  Object.entries(STRIP_SCALE_ROWS).map(([methodId, rows]) => [
    methodId,
    Object.fromEntries(rows.map(row => [row.measurement, row.swatches]))
  ])
);

interface LegacySwatch {
  label: string;
  min: number;
  max: number;
}

const legacy = (label: string, value: number): LegacySwatch => ({ label, min: value, max: value });
const legacyRange = (label: string, min: number, max: number): LegacySwatch => ({ label, min, max });

// Exact scales that were in the app before the 2026-09-06 bottle transcript correction.
const LEGACY_SEVEN_WAY: Partial<Record<MeasurementKey, LegacySwatch[]>> = {
  free_chlorine: [legacy('0', 0), legacy('0.5/1', 0.5), legacy('1/2', 1), legacy('3/6', 3), legacy('5/11', 5), legacy('10/22', 10)],
  ph: [legacy('6.2', 6.2), legacy('6.8', 6.8), legacy('7.2', 7.2), legacy('7.6', 7.6), legacy('7.8', 7.8), legacy('8.4', 8.4)],
  total_alkalinity: [legacy('0', 0), legacy('40', 40), legacy('80', 80), legacy('120', 120), legacy('180', 180), legacy('240', 240), legacy('400', 400)],
  total_chlorine: [legacy('0', 0), legacy('0.25', 0.25), legacy('0.5', 0.5), legacy('1', 1), legacy('2.5', 2.5), legacy('5', 5)],
  calcium_hardness: [legacy('0', 0), legacy('100', 100), legacy('250', 250), legacy('500', 500), legacy('1000', 1000)],
  cyanuric_acid: [legacy('0', 0), legacyRange('30–50', 30, 50), legacy('100', 100), legacy('150', 150), legacy('240', 240)]
};

function sameNumber(a: number | undefined, b: number) {
  return typeof a === 'number' && Math.abs(a - b) < 0.0001;
}

function normalizeLabel(value: string) {
  return value.trim().replace(/[–—]/g, '-').replace(/\s+/g, '');
}

function indexFromNote(reading: MeasurementReading, legacyScale: LegacySwatch[]) {
  const note = reading.note || '';
  const exactPrefix = 'Selected bottle swatch ';
  if (note.startsWith(exactPrefix)) {
    const raw = note.slice(exactPrefix.length).split('.')[0] || '';
    const wanted = normalizeLabel(raw);
    const index = legacyScale.findIndex(item => normalizeLabel(item.label) === wanted);
    if (index >= 0) return { kind: 'swatch' as const, index };
  }

  const betweenPrefix = 'Colour judged between bottle swatches ';
  if (note.startsWith(betweenPrefix)) {
    const raw = note.slice(betweenPrefix.length).split('.')[0] || '';
    const parts = raw.split(' and ');
    if (parts.length === 2) {
      const left = normalizeLabel(parts[0]);
      const right = normalizeLabel(parts[1]);
      const index = legacyScale.findIndex((item, itemIndex) =>
        itemIndex < legacyScale.length - 1 &&
        normalizeLabel(item.label) === left &&
        normalizeLabel(legacyScale[itemIndex + 1].label) === right
      );
      if (index >= 0) return { kind: 'between' as const, index };
    }
  }

  if (typeof reading.value === 'number') {
    const index = legacyScale.findIndex(item => item.min === item.max && sameNumber(reading.value, item.min));
    if (index >= 0) return { kind: 'swatch' as const, index };
  }

  if (typeof reading.min === 'number' && typeof reading.max === 'number') {
    const exactRange = legacyScale.findIndex(item => sameNumber(reading.min, item.min) && sameNumber(reading.max, item.max));
    if (exactRange >= 0) return { kind: 'swatch' as const, index: exactRange };
    const between = legacyScale.findIndex((item, index) => {
      const right = legacyScale[index + 1];
      return right && sameNumber(reading.min, item.max) && sameNumber(reading.max, right.min);
    });
    if (between >= 0) return { kind: 'between' as const, index: between };
  }

  return null;
}

function migrationBase(reading: MeasurementReading) {
  return {
    measurement: reading.measurement,
    source: reading.source,
    ...(typeof reading.confidence === 'number' ? { confidence: reading.confidence } : {})
  };
}

export interface SevenWayReadingCorrection {
  readings: MeasurementReading[];
  correctedCount: number;
  unresolvedCount: number;
  alreadyCurrent: boolean;
}

export function correctLegacySevenWayReadings(readings: MeasurementReading[]): SevenWayReadingCorrection {
  if (readings.some(reading => reading.note?.includes(SEVEN_WAY_NOTE_MARKER))) {
    return { readings, correctedCount: 0, unresolvedCount: 0, alreadyCurrent: true };
  }

  const newScaleMap = STRIP_SCALES['current-7-way'] || {};
  let correctedCount = 0;
  let unresolvedCount = 0;

  const corrected = readings.map(reading => {
    const legacyScale = LEGACY_SEVEN_WAY[reading.measurement];
    const newScale = newScaleMap[reading.measurement];
    if (!legacyScale || !newScale) return reading;

    const selection = indexFromNote(reading, legacyScale);
    if (!selection) {
      unresolvedCount++;
      return reading;
    }

    if (selection.kind === 'swatch') {
      const oldItem = legacyScale[selection.index];
      const nextItem = newScale[selection.index];
      correctedCount++;
      if (!nextItem) {
        unresolvedCount++;
        return {
          ...migrationBase(reading),
          note: `Legacy 7-in-1 swatch position ${selection.index + 1} (${oldItem?.label ?? 'unknown'}) has no corresponding swatch on the verified bottle; review required. ${SEVEN_WAY_NOTE_MARKER}`
        };
      }
      const note = `Selected bottle swatch ${nextItem.label}. Corrected from legacy swatch position ${selection.index + 1} (previously labelled ${oldItem?.label ?? 'unknown'}). ${SEVEN_WAY_NOTE_MARKER}`;
      if (nextItem.min === nextItem.max) return { ...migrationBase(reading), value: nextItem.min, note };
      return { ...migrationBase(reading), min: nextItem.min, max: nextItem.max, note };
    }

    const oldLeft = legacyScale[selection.index];
    const oldRight = legacyScale[selection.index + 1];
    const newLeft = newScale[selection.index];
    const newRight = newScale[selection.index + 1];
    correctedCount++;
    if (!newLeft || !newRight) {
      unresolvedCount++;
      return {
        ...migrationBase(reading),
        note: `Legacy 7-in-1 between-swatch position ${selection.index + 1}/${selection.index + 2} has no verified equivalent; review required. ${SEVEN_WAY_NOTE_MARKER}`
      };
    }
    return {
      ...migrationBase(reading),
      min: Math.min(newLeft.max, newRight.min),
      max: Math.max(newLeft.max, newRight.min),
      note: `Colour judged between bottle swatches ${newLeft.label} and ${newRight.label}. Corrected from legacy labels ${oldLeft?.label ?? '?'} and ${oldRight?.label ?? '?'}. ${SEVEN_WAY_NOTE_MARKER}`
    };
  });

  return { readings: corrected, correctedCount, unresolvedCount, alreadyCurrent: false };
}
