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
    if (point.connected === false || !finiteNumber(point.water)) {
      previous = null;
      continue;
    }
    if (previous) {
      const gap = point.timestamp - previous.timestamp;
      if (gap > 0 && Number.isFinite(gap)) gaps.push(gap);
    }
    previous = point;
  }

  const typicalGap = median(gaps);
  // Four missed samples is enough to treat the line as a separate run. The
  // five-minute floor keeps short-lived LAN polling jitter from splitting it.
  return Math.max(5 * 60 * 1000, (typicalGap ?? 0) * 5);
}

/**
 * Add a display-only water-temperature trend while preserving every raw value.
 *
 * CleverSpa temperature reports are quantised and can chatter between adjacent
 * values. A centred five-sample triangular moving average removes that display
 * jitter without changing stored telemetry. Runs are kept separate across a
 * disconnect, missing reading, or unusually large time gap.
 */
export function addWaterTrend<T extends TemperatureChartPoint>(points: T[]): Array<T & { waterTrend: number | null }> {
  const output = points.map(point => ({ ...point, waterTrend: null as number | null }));
  const gapThreshold = waterGapThreshold(points);
  let run: number[] = [];

  const smoothRun = () => {
    if (!run.length) return;
    const weights = [1, 2, 3, 2, 1];
    const offsets = [-2, -1, 0, 1, 2];

    for (let runIndex = 0; runIndex < run.length; runIndex += 1) {
      const outputIndex = run[runIndex];
      let weighted = 0;
      let totalWeight = 0;

      for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex += 1) {
        const neighbourRunIndex = runIndex + offsets[offsetIndex];
        if (neighbourRunIndex < 0 || neighbourRunIndex >= run.length) continue;
        const neighbour = points[run[neighbourRunIndex]];
        if (!finiteNumber(neighbour.water)) continue;
        const weight = weights[offsetIndex];
        weighted += neighbour.water * weight;
        totalWeight += weight;
      }

      output[outputIndex].waterTrend = totalWeight ? weighted / totalWeight : null;
    }
    run = [];
  };

  let previousIndex: number | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const valid = point.connected !== false && finiteNumber(point.water);
    const gapTooLarge = previousIndex !== null && point.timestamp - points[previousIndex].timestamp > gapThreshold;

    if (!valid || gapTooLarge) {
      smoothRun();
      previousIndex = null;
      if (!valid) continue;
    }

    run.push(index);
    previousIndex = index;
  }
  smoothRun();

  return output;
}
