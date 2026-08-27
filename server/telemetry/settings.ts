export const SYSTEM_TELEMETRY_INTERVAL_SECONDS = 60;

export interface TelemetrySettings {
  intervalSeconds: number;
  managedBy: 'system';
}

/**
 * Telemetry acquisition cadence is system-owned. Adapters may additionally push
 * status events; this interval is the generic watchdog/fallback and must work for
 * polling-only Wi-Fi adapters as well as manual or event-capable installations.
 */
export class TelemetrySettingsStore {
  async load(): Promise<TelemetrySettings> {
    return { intervalSeconds: SYSTEM_TELEMETRY_INTERVAL_SECONDS, managedBy: 'system' };
  }

  async save(): Promise<never> {
    throw new Error('Telemetry polling is managed automatically by Spararama.');
  }
}

export function validateTelemetryIntervalSeconds(_value: unknown) {
  return SYSTEM_TELEMETRY_INTERVAL_SECONDS;
}
