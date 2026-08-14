import type { TelemetrySample } from './types';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMeaningfulTransition(previous: TelemetrySample, current: TelemetrySample) {
  const previousTarget = finite(previous.spa.targetTemperatureC) ? previous.spa.targetTemperatureC : null;
  const currentTarget = finite(current.spa.targetTemperatureC) ? current.spa.targetTemperatureC : null;
  return previous.spa.connected !== current.spa.connected
    || previous.spa.heaterOn !== current.spa.heaterOn
    || previousTarget !== currentTarget;
}

function evenlySelect(indices: number[], count: number) {
  if (indices.length <= count) return indices;
  if (count <= 1) return [indices[0]];
  const selected = new Set<number>();
  for (let slot = 0; slot < count; slot += 1) {
    const position = Math.round((slot * (indices.length - 1)) / (count - 1));
    selected.add(indices[position]);
  }
  return Array.from(selected).sort((a, b) => a - b);
}

/**
 * Reduce long telemetry series without averaging away the behaviour we care about.
 *
 * Always favour:
 * - heater on/off transitions;
 * - target-temperature changes;
 * - connection loss/recovery;
 * - local temperature minima/maxima.
 *
 * This is intentionally a chart roll-up, not a replacement for the raw archive.
 */
export function rollUpTelemetry(samples: TelemetrySample[], maxPoints = 500): TelemetrySample[] {
  if (samples.length <= maxPoints) return samples;
  const safeMax = Math.max(20, Math.floor(maxPoints));
  const mandatory = new Set<number>([0, samples.length - 1]);

  for (let index = 1; index < samples.length; index += 1) {
    if (isMeaningfulTransition(samples[index - 1], samples[index])) {
      mandatory.add(index - 1);
      mandatory.add(index);
    }
  }

  const mandatoryIndices = Array.from(mandatory).sort((a, b) => a - b);
  if (mandatoryIndices.length >= safeMax) {
    return evenlySelect(mandatoryIndices, safeMax).map(index => samples[index]);
  }

  const remainingBudget = safeMax - mandatoryIndices.length;
  const bucketCount = Math.max(1, Math.floor(remainingBudget / 2));
  const candidates = new Set<number>(mandatoryIndices);
  const bucketSize = samples.length / bucketCount;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(samples.length, Math.floor((bucket + 1) * bucketSize));
    let minIndex: number | null = null;
    let maxIndex: number | null = null;
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;

    for (let index = start; index < end; index += 1) {
      const value = samples[index].spa.waterTemperatureC;
      if (!finite(value)) continue;
      if (value < minValue) { minValue = value; minIndex = index; }
      if (value > maxValue) { maxValue = value; maxIndex = index; }
    }

    if (minIndex !== null) candidates.add(minIndex);
    if (maxIndex !== null) candidates.add(maxIndex);
  }

  const selected = Array.from(candidates).sort((a, b) => a - b);
  if (selected.length <= safeMax) return selected.map(index => samples[index]);

  // Extremely transition-heavy data is unusual for a spa, but keep the hard chart cap.
  return evenlySelect(selected, safeMax).map(index => samples[index]);
}
