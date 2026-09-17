import type { TelemetrySensorSource } from '../telemetry/collector';
import type { SensorReading } from '../telemetry/types';

class CompositeSensorSource implements TelemetrySensorSource {
  constructor(private readonly sources: TelemetrySensorSource[]) {}

  async read(): Promise<SensorReading[]> {
    const results = await Promise.allSettled(this.sources.map(source => source.read()));
    const readings: SensorReading[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') readings.push(...result.value);
      else console.warn(`Environmental sensor source unavailable: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
    return readings;
  }
}

export function combineSensorSources(...sources: Array<TelemetrySensorSource | undefined>) {
  const active = sources.filter((source): source is TelemetrySensorSource => Boolean(source));
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  return new CompositeSensorSource(active);
}
