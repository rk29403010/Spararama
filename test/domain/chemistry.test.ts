import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessChemistry,
  canIgnoreImpossibleTotalChlorineZero,
  followUpAfterDose,
  ignoreImpossibleTotalChlorineZero,
  validateReadings
} from '../../src/domain/chemistry';
import { createDefaultDomainState } from '../../src/domain/defaults';
import type { MeasurementReading } from '../../src/domain/models';

function setup() {
  const domain = createDefaultDomainState();
  const waterBody = domain.waterBodies[0];
  return { domain, waterBody };
}

test('TA dose scales by vessel volume and configured product strength', () => {
  const { domain, waterBody } = setup();
  const taTarget = waterBody.targets.find(t => t.measurement === 'total_alkalinity');
  assert.ok(taTarget);
  taTarget.preferred = 80;

  const readings: MeasurementReading[] = [
    { measurement: 'total_alkalinity', value: 40, source: 'manual' },
    { measurement: 'ph', value: 7.4, source: 'manual' },
    { measurement: 'free_chlorine', value: 4, source: 'manual' }
  ];

  const assessment = assessChemistry(waterBody, domain.products, readings);
  assert.equal(assessment.nextAction.kind, 'dose');
  if (assessment.nextAction.kind !== 'dose') return;
  assert.equal(assessment.nextAction.productId, 'cleverspa-ta-plus');
  assert.equal(assessment.nextAction.amount, 51);
  assert.equal(assessment.nextAction.unit, 'g');

  const followUp = followUpAfterDose(assessment.nextAction);
  assert.equal(followUp.waitMinutes, 20);
  assert.deepEqual(followUp.retest, ['total_alkalinity', 'ph']);
});

test('an ambiguous reading overlapping the target does not trigger a dose', () => {
  const { domain, waterBody } = setup();
  const readings: MeasurementReading[] = [
    { measurement: 'total_alkalinity', min: 80, max: 120, source: 'manual' },
    { measurement: 'ph', min: 6.8, max: 7.2, source: 'manual' },
    { measurement: 'free_chlorine', value: 4, source: 'manual' }
  ];

  const assessment = assessChemistry(waterBody, domain.products, readings);
  assert.equal(assessment.nextAction.kind, 'retest');
  if (assessment.nextAction.kind !== 'retest') return;
  assert.deepEqual(assessment.nextAction.measurements, ['ph']);
});

test('free chlorine above total chlorine blocks dosing', () => {
  const findings = validateReadings([
    { measurement: 'free_chlorine', value: 1, source: 'manual' },
    { measurement: 'total_chlorine', value: 0, source: 'manual' }
  ]);
  assert.ok(findings.some(f => f.code === 'free_chlorine_above_total_chlorine' && f.severity === 'error'));
});

test('an impossible TC zero can be explicitly ignored without losing the recorded value', () => {
  const readings: MeasurementReading[] = [
    { measurement: 'free_chlorine', value: 1, source: 'manual' },
    { measurement: 'total_chlorine', value: 0, source: 'manual', note: 'Selected bottle swatch 0.' }
  ];

  assert.equal(canIgnoreImpossibleTotalChlorineZero(readings), true);
  const ignored = ignoreImpossibleTotalChlorineZero(readings);
  const total = ignored.find(reading => reading.measurement === 'total_chlorine');
  assert.equal(total?.value, 0);
  assert.equal(total?.ignoredForAdvice, true);
  assert.match(total?.ignoreReason || '', /conflicts with measurable free chlorine/);
  const findings = validateReadings(ignored);
  assert.equal(findings.some(f => f.code === 'free_chlorine_above_total_chlorine'), false);
  assert.ok(findings.some(f => f.code === 'reading_ignored_for_advice' && f.measurement === 'total_chlorine'));
});

test('ignoring impossible TC zero lets the other readings drive dosing advice', () => {
  const { domain, waterBody } = setup();
  const readings = ignoreImpossibleTotalChlorineZero([
    { measurement: 'total_alkalinity', value: 80, source: 'manual' },
    { measurement: 'ph', value: 7.4, source: 'manual' },
    { measurement: 'free_chlorine', value: 0.5, source: 'manual' },
    { measurement: 'total_chlorine', value: 0, source: 'manual' },
    { measurement: 'calcium_hardness', value: 250, source: 'manual' },
    { measurement: 'cyanuric_acid', min: 30, max: 50, source: 'manual' }
  ] as MeasurementReading[]);

  const assessment = assessChemistry(waterBody, domain.products, readings);
  assert.equal(assessment.nextAction.kind, 'dose');
  if (assessment.nextAction.kind !== 'dose') return;
  assert.equal(assessment.nextAction.productId, 'cleverspa-chlorine-granules');
  assert.equal(assessment.nextAction.amount, 6);
  assert.ok(assessment.findings.some(f => f.code === 'reading_ignored_for_advice'));
});

test('the TC override is limited to exact zero with definitely positive free chlorine', () => {
  assert.equal(canIgnoreImpossibleTotalChlorineZero([
    { measurement: 'free_chlorine', value: 3, source: 'manual' },
    { measurement: 'total_chlorine', value: 1, source: 'manual' }
  ]), false);
  assert.equal(canIgnoreImpossibleTotalChlorineZero([
    { measurement: 'free_chlorine', min: 0, max: 0.5, source: 'manual' },
    { measurement: 'total_chlorine', value: 0, source: 'manual' }
  ]), false);
});

test('excess combined chlorine blocks a ready result', () => {
  const { domain, waterBody } = setup();
  const readings: MeasurementReading[] = [
    { measurement: 'total_alkalinity', value: 80, source: 'manual' },
    { measurement: 'ph', value: 7.4, source: 'manual' },
    { measurement: 'free_chlorine', value: 3, source: 'manual' },
    { measurement: 'total_chlorine', value: 5, source: 'manual' },
    { measurement: 'calcium_hardness', value: 250, source: 'manual' },
    { measurement: 'cyanuric_acid', min: 30, max: 50, source: 'manual' }
  ];

  const assessment = assessChemistry(waterBody, domain.products, readings);
  assert.equal(assessment.nextAction.kind, 'retest');
  assert.ok(assessment.findings.some(f => f.code === 'combined_chlorine_high' && f.severity === 'error'));
});

test('ambiguous free/total chlorine that could hide high combined chlorine blocks ready', () => {
  const findings = validateReadings([
    { measurement: 'free_chlorine', value: 3, source: 'manual' },
    { measurement: 'total_chlorine', min: 3, max: 5, source: 'manual' }
  ]);
  assert.ok(findings.some(f => f.code === 'combined_chlorine_uncertain' && f.severity === 'error'));
});

test('matching free and total chlorine does not create a combined chlorine error', () => {
  const findings = validateReadings([
    { measurement: 'free_chlorine', value: 3, source: 'manual' },
    { measurement: 'total_chlorine', value: 3, source: 'manual' }
  ]);
  assert.equal(findings.some(f => f.code === 'combined_chlorine_high' || f.code === 'combined_chlorine_uncertain'), false);
});

test('pH adjustment uses a scaled label dose rather than pretending pH is linear', () => {
  const { domain, waterBody } = setup();
  const readings: MeasurementReading[] = [
    { measurement: 'total_alkalinity', value: 80, source: 'manual' },
    { measurement: 'ph', value: 6.8, source: 'manual' },
    { measurement: 'free_chlorine', value: 4, source: 'manual' }
  ];

  const assessment = assessChemistry(waterBody, domain.products, readings);
  assert.equal(assessment.nextAction.kind, 'dose');
  if (assessment.nextAction.kind !== 'dose') return;
  assert.equal(assessment.nextAction.productId, 'cleverspa-ph-plus');
  assert.equal(assessment.nextAction.amount, 9);
  assert.equal(assessment.nextAction.mixMinutes, 15);
});

test('chlorine is handled after alkalinity and pH are acceptable', () => {
  const { domain, waterBody } = setup();
  const readings: MeasurementReading[] = [
    { measurement: 'total_alkalinity', value: 80, source: 'manual' },
    { measurement: 'ph', value: 7.4, source: 'manual' },
    { measurement: 'free_chlorine', value: 0.5, source: 'manual' }
  ];

  const assessment = assessChemistry(waterBody, domain.products, readings);
  assert.equal(assessment.nextAction.kind, 'dose');
  if (assessment.nextAction.kind !== 'dose') return;
  assert.equal(assessment.nextAction.productId, 'cleverspa-chlorine-granules');
  assert.equal(assessment.nextAction.amount, 6);
});
