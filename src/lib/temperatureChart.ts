export interface TemperatureChartPoint {
  timestamp: number;
  water?: number | null;
  target?: number | null;
  connected?: boolean;
  [key: string]: unknown;
}

export interface WaterTrendGap {
  startTimestamp: number;
  endTimestamp: number;
  startValue: number;
  endValue: number;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function waterGapThreshold(points: TemperatureChartPoint[]) {
  const gaps: number[] = [];
  let previous: TemperatureChartPoint | null = null;

  for (const point of points) {
    if (point.connected === false) {
      previous = null;
      continue;
    }
    if (!finiteNumber(point.water)) continue;
    if (previous) {
      const gap = point.timestamp - previous.timestamp;
      if (gap > 0 && Number.isFinite(gap)) gaps.push(gap);
    }
    previous = point;
  }

  const typicalGap = median(gaps);
  // A long telemetry silence should remain visible as a gap, but ordinary sparse
  // event logging must not split an otherwise continuous water-temperature run.
  return Math.max(30 * 60 * 1000, (typicalGap ?? 0) * 6);
}

function nearlyEqual(a: number, b: number, tolerance = 0.05) {
  return Math.abs(a - b) <= tolerance;
}

interface Anchor {
  index: number;
  timestamp: number;
  value: number;
  samples: number;
}

function targetAt<T extends TemperatureChartPoint>(points: T[], anchor: Anchor) {
  const target = points[anchor.index].target;
  return finiteNumber(target) ? target : null;
}

/**
 * A CleverSpa at target commonly chatters between adjacent integer readings
 * while its thermostat cycles. That is not useful as a thick zig-zag on the
 * history chart. Smooth only those near-target anchors over a short centred
 * time window; the raw readings remain available to the tooltip and telemetry.
 */
function stabiliseTargetHold<T extends TemperatureChartPoint>(points: T[], anchors: Anchor[]) {
  const original = anchors.map(anchor => anchor.value);
  const radiusMs = 30 * 60 * 1000;

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const target = targetAt(points, anchor);
    if (target === null || Math.abs(original[index] - target) > 1.1) continue;

    let weighted = 0;
    let weightTotal = 0;
    let candidates = 0;
    for (let neighbourIndex = 0; neighbourIndex < anchors.length; neighbourIndex += 1) {
      const neighbour = anchors[neighbourIndex];
      const neighbourTarget = targetAt(points, neighbour);
      const distance = Math.abs(neighbour.timestamp - anchor.timestamp);
      if (distance > radiusMs || neighbourTarget === null || Math.abs(neighbourTarget - target) > 0.1) continue;
      if (Math.abs(original[neighbourIndex] - target) > 1.1) continue;

      // The centre point matters most, but nearby thermostat cycles contribute
      // enough to turn 39/40/39/40 chatter into a stable ~39.5°C hold line.
      const weight = 1 + (radiusMs - distance) / radiusMs;
      weighted += original[neighbourIndex] * weight;
      weightTotal += weight;
      candidates += 1;
    }

    if (candidates >= 3 && weightTotal > 0) anchor.value = weighted / weightTotal;
  }
}

/**
 * CleverSpa reports a quantised temperature. If the stored sequence is
 * 30,30,30,31,31,31,32, the water did not physically jump in whole-degree
 * steps; the underlying temperature rose continuously through those buckets.
 *
 * Build display anchors only when the reported bucket changes, retain the end
 * of the final plateau, remove isolated one-reading reversals, then interpolate
 * by elapsed time. Raw telemetry is never modified.
 */
function trendForRun<T extends TemperatureChartPoint>(points: T[], run: number[], output: Array<T & { waterTrend: number | null }>) {
  if (!run.length) return;

  const anchors: Anchor[] = [];
  for (const index of run) {
    const value = points[index].water;
    if (!finiteNumber(value)) continue;
    const previous = anchors[anchors.length - 1];
    if (previous && nearlyEqual(previous.value, value)) {
      previous.samples += 1;
    } else {
      anchors.push({ index, timestamp: points[index].timestamp, value, samples: 1 });
    }
  }

  const lastIndex = run[run.length - 1];
  const lastValue = points[lastIndex].water;
  if (finiteNumber(lastValue)) {
    const lastAnchor = anchors[anchors.length - 1];
    if (!lastAnchor || lastAnchor.index !== lastIndex) {
      anchors.push({
        index: lastIndex,
        timestamp: points[lastIndex].timestamp,
        value: lastValue,
        samples: lastAnchor && nearlyEqual(lastAnchor.value, lastValue) ? lastAnchor.samples : 1
      });
    }
  }

  // Remove only an isolated one-reading wobble such as 34 -> 33 -> 34. A real
  // plateau/peak survives because it has more than one telemetry observation.
  for (let index = 1; index < anchors.length - 1; index += 1) {
    const before = anchors[index - 1];
    const current = anchors[index];
    const after = anchors[index + 1];
    const reversal = (current.value - before.value) * (after.value - current.value) < 0;
    const neighboursAgree = Math.abs(before.value - after.value) <= 0.25;
    const brief = after.timestamp - before.timestamp <= 45 * 60 * 1000;
    if (current.samples === 1 && reversal && neighboursAgree && brief) {
      current.value = (before.value + after.value) / 2;
    }
  }

  stabiliseTargetHold(points, anchors);

  if (anchors.length === 1) {
    const start = run[0];
    const end = run[run.length - 1];
    for (let index = start; index <= end; index += 1) {
      if (points[index].connected === false) continue;
      output[index].waterTrend = anchors[0].value;
    }
    return;
  }

  let anchorIndex = 0;
  const start = run[0];
  const end = run[run.length - 1];
  for (let pointIndex = start; pointIndex <= end; pointIndex += 1) {
    if (points[pointIndex].connected === false) continue;
    const timestamp = points[pointIndex].timestamp;

    while (anchorIndex < anchors.length - 2 && timestamp > anchors[anchorIndex + 1].timestamp) {
      anchorIndex += 1;
    }

    const before = anchors[anchorIndex];
    const after = anchors[Math.min(anchorIndex + 1, anchors.length - 1)];
    if (timestamp <= before.timestamp || before.timestamp === after.timestamp) {
      output[pointIndex].waterTrend = before.value;
      continue;
    }
    if (timestamp >= after.timestamp) {
      output[pointIndex].waterTrend = after.value;
      continue;
    }

    const fraction = (timestamp - before.timestamp) / (after.timestamp - before.timestamp);
    output[pointIndex].waterTrend = before.value + (after.value - before.value) * fraction;
  }
}

/**
 * Add a display-only continuous water-temperature trend while preserving every
 * raw value. Runs stay separate across an explicit disconnect or a substantial
 * telemetry gap. Non-water events inside a run inherit the interpolated trend
 * rather than creating artificial breaks in the graph.
 */
export function addWaterTrend<T extends TemperatureChartPoint>(points: T[]): Array<T & { waterTrend: number | null }> {
  const output = points.map(point => ({ ...point, waterTrend: null as number | null }));
  const gapThreshold = waterGapThreshold(points);
  let run: number[] = [];
  let previousWaterIndex: number | null = null;

  const flush = () => {
    trendForRun(points, run, output);
    run = [];
    previousWaterIndex = null;
  };

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.connected === false) {
      flush();
      continue;
    }
    if (!finiteNumber(point.water)) continue;

    if (previousWaterIndex !== null && point.timestamp - points[previousWaterIndex].timestamp > gapThreshold) {
      flush();
    }

    run.push(index);
    previousWaterIndex = index;
  }
  flush();

  return output;
}

/**
 * Return straight endpoints for gaps in the display trend. The UI draws these
 * with a dashed line so continuity is visually suggested without implying that
 * Spararama actually observed temperatures inside the missing period.
 */
export function findWaterTrendGaps<T extends TemperatureChartPoint & { waterTrend?: number | null }>(points: T[]): WaterTrendGap[] {
  const gaps: WaterTrendGap[] = [];
  const gapThreshold = waterGapThreshold(points);
  let previousKnown: T | null = null;
  let sawBreak = false;

  for (const point of points) {
    const known = finiteNumber(point.waterTrend);
    if (!known) {
      if (point.connected === false) sawBreak = true;
      continue;
    }

    if (previousKnown) {
      const elapsed = point.timestamp - previousKnown.timestamp;
      if (sawBreak || elapsed > gapThreshold) {
        gaps.push({
          startTimestamp: previousKnown.timestamp,
          endTimestamp: point.timestamp,
          startValue: previousKnown.waterTrend as number,
          endValue: point.waterTrend as number
        });
      }
    }

    previousKnown = point;
    sawBreak = false;
  }

  return gaps;
}
