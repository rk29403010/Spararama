import fs from 'node:fs/promises';
import path from 'node:path';

export interface SpaHealthAlertSettings {
  offlineAlertsPaused: boolean;
  offlineAlertsPausedUntil?: number;
  updatedAt?: number;
  updatedByUid?: string;
}

const DEFAULTS: SpaHealthAlertSettings = { offlineAlertsPaused: false };

export class SpaHealthSettingsStore {
  readonly statePath: string;
  private operation = Promise.resolve();

  constructor(baseDir = process.env.NOTIFICATION_DIR || path.join(process.cwd(), 'data', 'notifications')) {
    this.statePath = path.join(baseDir, 'spa-health.json');
  }

  async get(now = Date.now()): Promise<SpaHealthAlertSettings> {
    let settings: SpaHealthAlertSettings;
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      settings = {
        offlineAlertsPaused: Boolean(parsed?.offlineAlertsPaused),
        ...(Number.isFinite(parsed?.offlineAlertsPausedUntil) ? { offlineAlertsPausedUntil: Number(parsed.offlineAlertsPausedUntil) } : {}),
        ...(Number.isFinite(parsed?.updatedAt) ? { updatedAt: Number(parsed.updatedAt) } : {}),
        ...(typeof parsed?.updatedByUid === 'string' ? { updatedByUid: parsed.updatedByUid } : {})
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { ...DEFAULTS };
      throw error;
    }

    if (settings.offlineAlertsPaused && settings.offlineAlertsPausedUntil && settings.offlineAlertsPausedUntil <= now) {
      return this.update({ offlineAlertsPaused: false }, undefined, now);
    }
    return settings;
  }

  update(
    input: { offlineAlertsPaused: boolean; offlineAlertsPausedUntil?: number },
    uid?: string,
    now = Date.now()
  ) {
    return this.enqueue(async () => {
      const paused = Boolean(input.offlineAlertsPaused);
      const until = paused && Number.isFinite(input.offlineAlertsPausedUntil)
        ? Number(input.offlineAlertsPausedUntil)
        : undefined;
      if (until !== undefined && until <= now) throw new Error('Pause end time must be in the future.');
      // Avoid accidentally suppressing alerts for months because of a bad client timestamp.
      if (until !== undefined && until > now + (8 * 24 * 60 * 60_000)) {
        throw new Error('Pause end time cannot be more than 8 days away.');
      }
      const next: SpaHealthAlertSettings = {
        offlineAlertsPaused: paused,
        ...(until !== undefined ? { offlineAlertsPausedUntil: until } : {}),
        updatedAt: now,
        ...(uid ? { updatedByUid: uid } : {})
      };
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      const temp = `${this.statePath}.${process.pid}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await fs.rename(temp, this.statePath);
      return next;
    });
  }

  async isOfflineAlertSuppressed(now = Date.now()) {
    return (await this.get(now)).offlineAlertsPaused;
  }

  private enqueue<T>(work: () => Promise<T>) {
    const result = this.operation.then(work, work);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }
}
