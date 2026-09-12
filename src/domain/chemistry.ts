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
import { spoonDoseForProduct } from './spoons';

interface ReadingBounds {
  min: number;
  max: number;
}

const MEASUREMENT_LABELS: Record<MeasurementKey, string> = {
  free_chlorine: 'Free chlorine',
  total_chlorine: 'Total chlorine',
  bromine: 'Bromine',
  ph: 'pH',
  total_alkalinity: 'Total alkalinity',
  calcium_hardness: 'Total hardness',
  cyanuric_acid: 'Cyanuric acid'
};

export function measurementLabel(measurement: MeasurementKey) {
  return MEASUREMENT_LABELS[measurement];
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

export function estimatedReadingValue(reading: MeasurementReading) {
  const value = bounds(reading);
  if (!value) return null;
  return (value.min + value.max) / 2;
}

function isRangeReading(reading: MeasurementReading) {
  const value = bounds(reading);
  return Boolean(value && value.min !== value.max);
}

function formatEstimate(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function estimateSuffix(reading: MeasurementReading, target: TargetRange) {
  if (!isRangeReading(reading)) return '';
  const estimate = estimatedReadingValue(reading);
  if (estimate === null) return '';
  const unit = target.unit === 'ph' ? '' : ` ${target.unit}`;
  return ` (about ${formatEstimate(estimate)}${unit})`;
}

function findRecordedReading(readings: MeasurementReading[], measurement: MeasurementKey) {
  return readings.find(reading => reading.measurement === measurement);
}

function findReading(readings: MeasurementReading[], measurement: MeasurementKey) {
  return readings.find(reading => reading.measurement === measurement && !reading.ignoredForAdvice);
}

function findTarget(waterBody: WaterBodyProfile, measurement: MeasurementKey) {
  return waterBody.targets.find(target => target.measurement === measurement);
}

function classify(reading: MeasurementReading, target: TargetRange) {
  const value = estimatedReadingValue(reading);
  if (value === null) return 'unknown' as const;
  if (value < target.min) return 'low' as const;
  if (value > target.max) return 'high' as const;
  return 'in_range' as const;
}

export function canIgnoreImpossibleTotalChlorineZero(readings: MeasurementReading[]) {
  const free = findRecordedReading(readings, 'free_chlorine');
  const total = findRecordedReading(readings, 'total_chlorine');
  if (!free || !total || free.ignoredForAdvice || total.ignoredForAdvice) return false;

  const freeBounds = bounds(free);
  const totalBounds = bounds(total);
  return Boolean(
    freeBounds &&
    totalBounds &&
    freeBounds.min > 0 &&
    totalBounds.min === 0 &&
    totalBounds.max === 0
  );
}

export function ignoreImpossibleTotalChlorineZero(readings: MeasurementReading[]) {
  if (!canIgnoreImpossibleTotalChlorineZero(readings)) return readings;
  return readings.map(reading => reading.measurement === 'total_chlorine'
    ? {
        ...reading,
        ignoredForAdvice: true,
        ignoreReason: 'Recorded 0 ppm total chlorine conflicts with measurable free chlorine; user chose to exclude this strip pad from advice.'
      }
    : reading);
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
  const current = estimatedReadingValue(reading);
  if (current === null) return null;

  if (model.kind === 'fixed_label') {
    const scaled = model.amount * (waterBody.volumeLiters / model.referenceVolumeLiters);
    return roundDose(scaled, waterBody.doseRounding ?? 1);
  }

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
    const label = measurementLabel(reading.measurement);
    if (reading.ignoredForAdvice) {
      findings.push({
        measurement: reading.measurement,
        severity: 'info',
        code: 'reading_ignored_for_advice',
        message: reading.measurement === 'total_chlorine'
          ? 'Total chlorine is recorded but not used for advice because this strip pad was marked unreliable. Free chlorine still drives chlorine dosing; combined chlorine cannot be checked from this reading.'
          : `${label} was recorded but is not being used for this advice.`
      });
      continue;
    }

    const readingBounds = bounds(reading);
    if (!readingBounds) {
      findings.push({
        measurement: reading.measurement,
        severity: 'warning',
        code: 'reading_missing_value',
        message: `No usable ${label} value was supplied.`
      });
      continue;
    }
    if (readingBounds.min < 0) {
      findings.push({
        measurement: reading.measurement,
        severity: 'error',
        code: 'reading_negative',
        message: `${label} cannot be negative.`
      });
    }
    if (typeof reading.confidence === 'number' && reading.confidence < 0.55) {
      findings.push({
        measurement: reading.measurement,
        severity: 'error',
        code: 'reading_low_confidence',
        message: `${label} has low confidence and must be confirmed before dosing.`
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
      message: 'Free chlorine cannot be higher than Total chlorine. Retest before dosing.'
    });
  } else if (freeBounds && totalBounds) {
    // Keep the free/total chlorine consistency check conservative. Ordinary
    // target classification and dosing use the midpoint of strip ranges, but
    // combined chlorine can be safety-relevant, so do not hide a possible high
    // combined-chlorine result behind the midpoint estimate.
    const minimumCombined = Math.max(0, totalBounds.min - freeBounds.max);
    const maximumCombined = Math.max(0, totalBounds.max - freeBounds.min);
    const definitelyHigh =
      minimumCombined >= 1 ||
      minimumCombined > freeBounds.max / 2;
    const possiblyHigh =
      maximumCombined >= 1 ||
      maximumCombined > freeBounds.min / 2;

    if (definitelyHigh) {
      findings.push({
        measurement: 'total_chlorine',
        severity: 'error',
        code: 'combined_chlorine_high',
        message: 'Combined chlorine is too high for the measured Free chlorine. Retest and correct the water before bathing.'
      });
    } else if (possiblyHigh) {
      findings.push({
        measurement: 'total_chlorine',
        severity: 'error',
        code: 'combined_chlorine_uncertain',
        message: 'The Free chlorine and Total chlorine ranges could indicate excessive combined chlorine. Use a clearer test before bathing or dosing.'
      });
    }
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

  const spoonDose = selected.model.unit === 'g'
    ? spoonDoseForProduct(selected.product.id, amount)
    : null;
  const productName = spoonDose
    ? `${selected.product.name} (~${spoonDose.text})`
    : selected.product.name;

  return {
    kind: 'dose',
    productId: selected.product.id,
    productName,
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

  const label = measurementLabel(measurement);
  const status = classify(reading, target);
  if (status === 'unknown') {
    return {
      action: {
        kind: 'retest',
        measurements: [measurement],
        reason: `${label} has no usable value. Use a fresh or more precise test before changing it.`
      }
    };
  }

  const suffix = estimateSuffix(reading, target);
  if (status === 'in_range') {
    return {
      finding: {
        measurement,
        severity: 'info',
        code: 'in_range',
        message: `${label}${suffix} is within the target range.`
      }
    };
  }

  const direction = status === 'low' ? 'raise' : 'lower';
  const finding: ChemistryFinding = {
    measurement,
    severity: 'warning',
    code: status,
    message: `${label} is ${status}${suffix}.`
  };
  const action = doseActionFor(
    waterBody,
    products,
    reading,
    target,
    direction,
    `${label} is ${status}${suffix}.`
  );

  return {
    finding,
    action: action ?? {
      kind: 'retest',
      measurements: [measurement],
      reason: `${label} is ${status}${suffix}, but no configured product can safely ${direction} it.`
    }
  };
}

function findingWithPlanContext(
  finding: ChemistryFinding,
  action: ChemistryNextAction | undefined,
  earlierAction: ChemistryNextAction | undefined
): ChemistryFinding {
  if (!action || action.kind !== 'dose' || (finding.code !== 'low' && finding.code !== 'high')) {
    return finding;
  }

  if (!earlierAction) {
    return {
      ...finding,
      message: `${finding.message} Correct it now: add ${action.amount} ${action.unit} ${action.productName}.`
    };
  }

  let earlierLabel = 'the current issue';
  if (earlierAction.kind === 'dose') {
    earlierLabel = measurementLabel(earlierAction.measurement);
  } else if (earlierAction.kind === 'retest' && earlierAction.measurements.length === 1) {
    earlierLabel = measurementLabel(earlierAction.measurements[0]);
  }

  return {
    ...finding,
    message: `${finding.message} Deal with this after ${earlierLabel}; retest it then so the dose uses a fresh reading.`
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
        measurements: readings
          .filter(reading => !reading.ignoredForAdvice)
          .map(reading => reading.measurement),
        reason: 'One or more readings conflict or are not reliable enough to dose from. Check the highlighted readings before dosing.'
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
    if (result.finding) {
      findings.push(findingWithPlanContext(result.finding, result.action, nextAction));
    }
    if (!nextAction && result.action) nextAction = result.action;
  }

  return {
    findings,
    nextAction: nextAction ?? {
      kind: 'none',
      reason: 'No chemistry adjustment is currently required.'
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
