import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_TELEMETRY_INTERVAL_SECONDS = 300;
export const MIN_TELEMETRY_INTERVAL_SECONDS = 60;
export const MAX_TELEMETRY_INTERVAL_SECONDS = 86_400;

export interface TelemetrySettings {
  intervalSeconds: number;
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

function environmentDefault() {
  const configured = process.env.TELEMETRY_INTERVAL_SECONDS;
  if (!configured) return DEFAULT_TELEMETRY_INTERVAL_SECONDS;
  try {
    return validateTelemetryIntervalSeconds(configured);
  } catch {
    console.warn(`Ignoring invalid TELEMETRY_INTERVAL_SECONDS=${JSON.stringify(configured)}; using ${DEFAULT_TELEMETRY_INTERVAL_SECONDS}.`);
    return DEFAULT_TELEMETRY_INTERVAL_SECONDS;
  }
}

export class TelemetrySettingsStore {
  readonly settingsPath: string;

  constructor(baseDir = process.env.TELEMETRY_DIR || path.join(process.cwd(), 'data', 'telemetry')) {
    this.settingsPath = path.join(baseDir, 'settings.json');
  }

  async load(): Promise<TelemetrySettings> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
      return { intervalSeconds: validateTelemetryIntervalSeconds(parsed?.intervalSeconds) };
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.warn(`Unable to load telemetry settings; using environment/default value: ${error?.message || String(error)}`);
      }
      return { intervalSeconds: environmentDefault() };
    }
  }

  async save(settings: TelemetrySettings) {
    const validated = { intervalSeconds: validateTelemetryIntervalSeconds(settings.intervalSeconds) };
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    const temporaryPath = `${this.settingsPath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, this.settingsPath);
    return validated;
  }
}
