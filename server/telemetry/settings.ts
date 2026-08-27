import fs from 'node:fs/promises';
import path from 'node:path';

export const SYSTEM_TELEMETRY_INTERVAL_SECONDS = 60;
export const DEFAULT_TELEMETRY_INTERVAL_SECONDS = 300;
export const MIN_TELEMETRY_INTERVAL_SECONDS = 60;
export const MAX_TELEMETRY_INTERVAL_SECONDS = 86_400;

export interface TelemetrySettings {
  intervalSeconds: number;
  managedBy?: 'system';
}

export function validateTelemetryIntervalSeconds(value: unknown) {
  const intervalSeconds = Number(value);
  if (!Number.isInteger(intervalSeconds)
    || intervalSeconds < MIN_TELEMETRY_INTERVAL_SECONDS
    || intervalSeconds > MAX_TELEMETRY_INTERVAL_SECONDS) {
    throw new Error(`Telemetry interval must be a whole number between ${MIN_TELEMETRY_INTERVAL_SECONDS} and ${MAX_TELEMETRY_INTERVAL_SECONDS} seconds.`);
  }
  return intervalSeconds;
}

/**
 * The normal application instance is system-owned and always returns the watchdog
 * cadence. An explicit directory is retained as a small persistence primitive for
 * tests/migrations; the server no longer exposes it as a user setting.
 */
export class TelemetrySettingsStore {
  readonly settingsPath?: string;
  private readonly isolated: boolean;

  constructor(baseDir?: string) {
    this.isolated = Boolean(baseDir);
    this.settingsPath = baseDir ? path.join(baseDir, 'settings.json') : undefined;
  }

  async load(): Promise<TelemetrySettings> {
    if (!this.isolated || !this.settingsPath) {
      return { intervalSeconds: SYSTEM_TELEMETRY_INTERVAL_SECONDS, managedBy: 'system' };
    }
    try {
      const parsed = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      return { intervalSeconds: validateTelemetryIntervalSeconds(parsed?.intervalSeconds) };
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      return { intervalSeconds: DEFAULT_TELEMETRY_INTERVAL_SECONDS };
    }
  }

  async save(settings: TelemetrySettings) {
    if (!this.isolated || !this.settingsPath) {
      throw new Error('Telemetry polling is managed automatically by Spararama.');
    }
    const validated = { intervalSeconds: validateTelemetryIntervalSeconds(settings.intervalSeconds) };
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    const temporaryPath = `${this.settingsPath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, this.settingsPath);
    return validated;
  }
}
