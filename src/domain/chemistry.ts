import type {
  ChemicalProduct,
  ChemistryAssessment,
  ChemistryFinding,
  ChemistryNextAction,
  DoseInstruction,
  DoseModel,
  MeasurementKey,
  MeasurementReading,
  TargetRange,
  WaterBodyProfile
} from './models';

interface ReadingBounds {
  min: number;
  max: number;
}

function bounds(reading: MeasurementReading): ReadingBounds | null {
  if (typeof reading.value === 'number') {
    return { min: reading.value, max: reading.value };
  }
  if (typeof reading.min === 'number' && typeof reading.max === 'number') {
    return reading.min <= reading.max
      ? { min: reading.min, max: reading.max }
      : { min: reading.max, max: reading.min };
  }
  return null;
}

function findReading(readings: MeasurementReading[], measurement: MeasurementKey) {
  return readings.find(reading => reading.measurement === measurement);
}

function findTarget(waterBody: WaterBodyProfile, measurement: MeasurementKey) {
  return waterBody.targets.find(target => target.measurement === measurement);
}

function classify(reading: MeasurementReading, target: TargetRange) {
  const value = bounds(reading);
  if (!value) return 'unknown' as const;
  if (value.max < target.min) return 'low' as const;
  if (value.min > target.max) return 'high' as const;
  if (value.min >= target.min && value.max <= target.max) return 'in_range' as const;
  return 'uncertain' as const;
}

function roundDose(value: number, increment = 1) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const safeIncrement = increment > 0 ? increment : 1;
  return Math.max(safeIncrement, Math.round(value / safeIncrement) * safeIncrement);
}

function chooseProduct(
  products: ChemicalProduct[],
  measurement: MeasurementKey,
  direction: 'raise' | 'lower'
): { product: ChemicalProduct; model: DoseModel } | null {
  for (const product of products) {
    const model = product.doseModels.find(
      candidate => candidate.measurement === measurement && candidate.direction === direction
    );
    if (model) return { product, model };
  }
  return null;
}

function calculateDose(
  product: ChemicalProduct,
  model: DoseModel,
  waterBody: WaterBodyProfile,
  reading: MeasurementReading,
  target: TargetRange
): number | null {
  const readingBounds = bounds(reading);
  if (!readingBounds) return null;

  if (model.kind === 'fixed_label') {
    const scaled = model.amount * (waterBody.volumeLiters / model.referenceVolumeLiters);
    return roundDose(scaled, waterBody.doseRounding ?? 1);
  }

  const current = model.direction === 'raise' ? readingBounds.max : readingBounds.min;
  const preferred = target.preferred ?? (model.direction === 'raise' ? target.min : target.max);
  const changeNeeded = model.direction === 'raise' ? preferred - current : current - preferred;
  if (changeNeeded <= 0) return null;

  const scaled =
    model.amount *
    (waterBody.volumeLiters / model.referenceVolumeLiters) *
    (changeNeeded / model.raisesBy);

  const rounded = roundDose(scaled, waterBody.doseRounding ?? 1);
  if (product.maxSingleDose && rounded > product.maxSingleDose) {
    return product.maxSingleDose;
  }
  return rounded;
}

export function validateReadings(readings: MeasurementReading[]): ChemistryFinding[] {
  const findings: ChemistryFinding[] = [];

  for (const reading of readings) {
    const readingBounds = bounds(reading);
    if (!readingBounds) {
      findings.push({
        measurement: reading.measurement,
        severity: 'warning',
        code: 'reading_missing_value',
        message: `No usable value was supplied for ${reading.measurement}.`
      });
      continue;
    }
    if (readingBounds.min < 0) {
      findings.push({
        measurement: reading.measurement,
        severity: 'error',
        code: 'reading_negative',
        message: `${reading.measurement} cannot be negative.`
      });
    }
    if (typeof reading.confidence === 'number' && reading.confidence < 0.55) {
      findings.push({
        measurement: reading.measurement,
        severity: 'error',
        code: 'reading_low_confidence',
        message: `${reading.measurement} has low confidence and must be confirmed before dosing.`
      });
    }
  }

  const free = findReading(readings, 'free_chlorine');
  const total = findReading(readings, 'total_chlorine');
  const freeBounds = free ? bounds(free) : null;
  const totalBounds = total ? bounds(total) : null;
  if (freeBounds && totalBounds && freeBounds.min > totalBounds.max) {
    findings.push({
      severity: 'error',
      code: 'free_chlorine_above_total_chlorine',
      message: 'Free chlorine cannot be higher than total chlorine. Retest before dosing.'
    });
  }

  return findings;
}

function doseActionFor(
  waterBody: WaterBodyProfile,
  products: ChemicalProduct[],
  reading: MeasurementReading,
  target: TargetRange,
  direction: 'raise' | 'lower',
  reason: string
): DoseInstruction | null {
  const selected = chooseProduct(products, target.measurement, direction);
  if (!selected) return null;

  const amount = calculateDose(selected.product, selected.model, waterBody, reading, target);
  if (!amount) return null;

  return {
    kind: 'dose',
    productId: selected.product.id,
    productName: selected.product.name,
    amount,
    unit: selected.model.unit,
    measurement: target.measurement,
    reason,
    mixMinutes: selected.product.mixMinutes,
    circulationRequired: selected.product.circulationRequired
  };
}

function assessmentForMeasurement(
  waterBody: WaterBodyProfile,
  products: ChemicalProduct[],
  readings: MeasurementReading[],
  measurement: MeasurementKey
): { finding?: ChemistryFinding; action?: ChemistryNextAction } {
  const reading = findReading(readings, measurement);
  const target = findTarget(waterBody, measurement);
  if (!reading || !target) return {};

  const status = classify(reading, target);
  if (status === 'unknown') {
    return {
      action: {
        kind: 'retest',
        measurements: [measurement],
        reason: `The ${measurement} reading is incomplete.`
      }
    };
  }

  if (status === 'uncertain') {
    return {
      finding: {
        measurement,
        severity: 'info',
        code: 'reading_overlaps_target',
        message: `${measurement} overlaps the target range; avoid dosing from an ambiguous reading.`
      },
      action: {
        kind: 'retest',
        measurements: [measurement],
        reason: `Confirm ${measurement} before changing it.`
      }
    };
  }

  if (status === 'in_range') {
    return {
      finding: {
        measurement,
        severity: 'info',
        code: 'in_range',
        message: `${measurement} is within its configured target range.`
      }
    };
  }

  const direction = status === 'low' ? 'raise' : 'lower';
  const finding: ChemistryFinding = {
    measurement,
    severity: 'warning',
    code: status,
    message: `${measurement} is ${status} for the active water-body profile.`
  };
  const action = doseActionFor(
    waterBody,
    products,
    reading,
    target,
    direction,
    `${measurement} is ${status}; move it toward ${target.preferred ?? `${target.min}-${target.max}`}.`
  );

  return {
    finding,
    action: action ?? {
      kind: 'retest',
      measurements: [measurement],
      reason: `No configured product can safely ${direction} ${measurement}.`
    }
  };
}

export function assessChemistry(
  waterBody: WaterBodyProfile,
  products: ChemicalProduct[],
  readings: MeasurementReading[]
): ChemistryAssessment {
  const findings = validateReadings(readings);
  const blocking = findings.some(finding => finding.severity === 'error');
  if (blocking) {
    return {
      findings,
      nextAction: {
        kind: 'retest',
        measurements: readings.map(reading => reading.measurement),
        reason: 'One or more readings are inconsistent or insufficiently reliable. Confirm them before dosing.'
      }
    };
  }

  const order: MeasurementKey[] = ['total_alkalinity', 'ph'];
  if (waterBody.sanitizer === 'bromine') order.push('bromine');
  else order.push('free_chlorine');
  order.push('calcium_hardness', 'cyanuric_acid');

  let nextAction: ChemistryNextAction | undefined;
  for (const measurement of order) {
    const result = assessmentForMeasurement(waterBody, products, readings, measurement);
    if (result.finding) findings.push(result.finding);
    if (!nextAction && result.action) nextAction = result.action;
  }

  return {
    findings,
    nextAction: nextAction ?? {
      kind: 'none',
      reason: 'No configured chemistry adjustment is currently required.'
    }
  };
}

export function followUpAfterDose(action: DoseInstruction) {
  const measurements: MeasurementKey[] = [action.measurement];
  if (action.measurement === 'total_alkalinity' && !measurements.includes('ph')) {
    measurements.push('ph');
  }
  return {
    circulationRequired: action.circulationRequired,
    waitMinutes: action.mixMinutes,
    retest: measurements
  };
}
