export interface TemperatureChartPoint {
  timestamp: number;
  water?: number | null;
  connected?: boolean;
  [key: string]: unknown;
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
}

/**
 * CleverSpa reports a quantised temperature. If the stored sequence is
 * 30,30,30,31,31,31,32, the water did not physically jump in whole-degree
 * steps; the underlying temperature rose continuously through those buckets.
 *
 * Build display anchors only when the reported bucket changes, retain the end
 * of a plateau, remove very short one-reading reversals, then interpolate by
 * elapsed time. Raw telemetry is never modified.
 */
function trendForRun<T extends TemperatureChartPoint>(points: T[], run: number[], output: Array<T & { waterTrend: number | null }>) {
  if (!run.length) return;

  const anchors: Anchor[] = [];
  for (const index of run) {
    const value = points[index].water;
    if (!finiteNumber(value)) continue;
    const previous = anchors[anchors.length - 1];
    if (!previous || !nearlyEqual(previous.value, value)) {
      anchors.push({ index, timestamp: points[index].timestamp, value });
    }
  }

  const lastIndex = run[run.length - 1];
  const lastValue = points[lastIndex].water;
  if (finiteNumber(lastValue)) {
    const lastAnchor = anchors[anchors.length - 1];
    if (!lastAnchor || lastAnchor.index !== lastIndex) {
      anchors.push({ index: lastIndex, timestamp: points[lastIndex].timestamp, value: lastValue });
    }
  }

  // Remove a brief one-bucket wobble such as 34 -> 33 -> 34. This is the
  // characteristic CleverSpa chatter visible as tiny teeth on an otherwise
  // smooth heating/cooling curve. Genuine sustained peaks still retain two or
  // more anchors and therefore survive this filter.
  for (let index = 1; index < anchors.length - 1; index += 1) {
    const before = anchors[index - 1];
    const current = anchors[index];
    const after = anchors[index + 1];
    const reversal = (current.value - before.value) * (after.value - current.value) < 0;
    const neighboursAgree = Math.abs(before.value - after.value) <= 0.25;
    const brief = after.timestamp - before.timestamp <= 45 * 60 * 1000;
    if (reversal && neighboursAgree && brief) {
      current.value = (before.value + after.value) / 2;
    }
  }

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
