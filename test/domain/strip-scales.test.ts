import assert from 'node:assert/strict';
import test from 'node:test';
import type { MeasurementReading } from '../../src/domain/models';
import {
  BAD_SEVEN_WAY_SCALE_INTRODUCED_AT,
  correctLegacySevenWayReadings,
  detectLegacySevenWayLayout,
  SEVEN_WAY_NOTE_MARKER,
  STRIP_SCALE_ROWS
} from '../../src/domain/stripScales';

test('verified 7-in-1 scale matches bottle transcript and order', () => {
  const rows = STRIP_SCALE_ROWS['current-7-way'];
  assert.deepEqual(rows.map(row => row.measurement), [
    'free_chlorine',
    'ph',
    'bromine',
    'total_alkalinity',
    'total_chlorine',
    'calcium_hardness',
    'cyanuric_acid'
  ]);
  assert.deepEqual(rows[0].swatches.map(item => item.label), ['0', '0.5', '1', '3', '5', '10']);
  assert.deepEqual(rows[1].swatches.map(item => item.label), ['6.2', '6.8', '7.2', '7.6', '8.4', '9.0']);
  assert.deepEqual(rows[2].swatches.map(item => item.label), ['0', '1', '2.0', '6.6', '11', '22']);
  assert.deepEqual(rows[3].swatches.map(item => item.label), ['0', '40', '80', '120', '180', '240']);
  assert.deepEqual(rows[4].swatches.map(item => item.label), ['0', '0.5', '1', '3', '5', '10']);
  assert.deepEqual(rows[5].swatches.map(item => item.label), ['0', '50', '100', '250', '500', '1000']);
  assert.deepEqual(rows[6].swatches.map(item => item.label), ['0', '30–50', '100', '150', '240']);
});

test('19/20 Aug original layout is detected and left unchanged', () => {
  const readings: MeasurementReading[] = [
    { measurement: 'free_chlorine', value: 3, source: 'manual', note: 'Selected bottle swatch 3.' },
    { measurement: 'ph', value: 8.4, source: 'manual', note: 'Selected bottle swatch 8.4.' },
    { measurement: 'calcium_hardness', value: 50, source: 'manual', note: 'Selected bottle swatch 50.' },
    { measurement: 'cyanuric_acid', min: 30, max: 50, source: 'manual', note: 'Selected bottle swatch 30/50.' }
  ];

  const detected = detectLegacySevenWayLayout(readings, BAD_SEVEN_WAY_SCALE_INTRODUCED_AT - 1000);
  assert.equal(detected.layout, 'original');
  assert.equal(detected.inferredFromTimestamp, false);

  const correction = correctLegacySevenWayReadings(readings, { recordedAt: BAD_SEVEN_WAY_SCALE_INTRODUCED_AT - 1000 });
  assert.equal(correction.layout, 'original');
  assert.equal(correction.correctedCount, 0);
  assert.deepEqual(correction.readings, readings);
});

test('bad layout is detected from distinctive labels and remapped by swatch position', () => {
  const readings: MeasurementReading[] = [
    { measurement: 'free_chlorine', value: 3, source: 'manual', note: 'Selected bottle swatch 3/6.' },
    { measurement: 'ph', value: 7.8, source: 'manual', note: 'Selected bottle swatch 7.8.' },
    { measurement: 'total_chlorine', value: 0.5, source: 'manual', note: 'Selected bottle swatch 0.5.' },
    { measurement: 'calcium_hardness', value: 250, source: 'manual', note: 'Selected bottle swatch 250.' },
    { measurement: 'cyanuric_acid', min: 30, max: 50, source: 'manual', note: 'Selected bottle swatch 30–50.' }
  ];

  const correction = correctLegacySevenWayReadings(readings);
  assert.equal(correction.layout, 'bad');
  assert.equal(correction.inferredFromTimestamp, false);
  assert.equal(correction.correctedCount, 5);

  const byMeasurement = Object.fromEntries(correction.readings.map(reading => [reading.measurement, reading]));
  assert.equal(byMeasurement.free_chlorine.value, 3);
  assert.equal(byMeasurement.ph.value, 8.4);
  // Third total-chlorine swatch: old bad layout recorded 0.5; bottle says 1.
  assert.equal(byMeasurement.total_chlorine.value, 1);
  // Third hardness swatch: old bad layout recorded 250; bottle says 100.
  assert.equal(byMeasurement.calcium_hardness.value, 100);
  assert.equal(byMeasurement.cyanuric_acid.min, 30);
  assert.equal(byMeasurement.cyanuric_acid.max, 50);
  assert.ok(correction.readings.every(reading => reading.note?.includes(SEVEN_WAY_NOTE_MARKER)));
});

test('ambiguous shared labels use record time only as a fallback', () => {
  const readings: MeasurementReading[] = [
    { measurement: 'free_chlorine', value: 0, source: 'manual', note: 'Selected bottle swatch 0.' },
    { measurement: 'ph', value: 7.2, source: 'manual', note: 'Selected bottle swatch 7.2.' },
    { measurement: 'total_alkalinity', value: 80, source: 'manual', note: 'Selected bottle swatch 80.' }
  ];

  assert.equal(detectLegacySevenWayLayout(readings).layout, 'ambiguous');

  const before = detectLegacySevenWayLayout(readings, BAD_SEVEN_WAY_SCALE_INTRODUCED_AT - 1);
  assert.equal(before.layout, 'original');
  assert.equal(before.inferredFromTimestamp, true);

  const after = detectLegacySevenWayLayout(readings, BAD_SEVEN_WAY_SCALE_INTRODUCED_AT + 1);
  assert.equal(after.layout, 'bad');
  assert.equal(after.inferredFromTimestamp, true);
});

test('bad TA 400 swatch is not invented as a verified value', () => {
  const readings: MeasurementReading[] = [
    { measurement: 'free_chlorine', value: 3, source: 'manual', note: 'Selected bottle swatch 3/6.' },
    { measurement: 'total_alkalinity', value: 400, source: 'manual', note: 'Selected bottle swatch 400.' }
  ];

  const correction = correctLegacySevenWayReadings(readings);
  assert.equal(correction.layout, 'bad');
  assert.equal(correction.correctedCount, 1);
  assert.equal(correction.unresolvedCount, 1);
  const ta = correction.readings.find(reading => reading.measurement === 'total_alkalinity');
  assert.equal(ta?.value, undefined);
  assert.ok(ta?.note?.includes('review required'));
});
