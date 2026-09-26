import type { HeatingSchedule } from '../heating/types';
import type { NotificationService } from '../notifications/service';
import type { SpaAdapter, SpaStatus } from '../spa/types';

export type SpaHealthState = 'online' | 'suspect' | 'offline';

export interface SpaHealthMonitorOptions {
  offlineAfterMs?: number;
  staleAfterMs?: number;
  checkIntervalMs?: number;
  now?: () => number;
}

export interface HeatingScheduleSource {
  listSchedules(): Promise<HeatingSchedule[]>;
}

const DEFAULT_OFFLINE_AFTER_MS = 3 * 60_000;
const DEFAULT_STALE_AFTER_MS = 90_000;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const INCIDENT_KEY = 'spa-connectivity';

function timeText(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export class SpaHealthMonitor {
  private readonly offlineAfterMs: number;
  private readonly staleAfterMs: number;
  private readonly checkIntervalMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();
  private state: SpaHealthState = 'online';
  private lastSuccessfulContactAt = 0;
  private suspectSince = 0;

  constructor(
    private readonly spa: SpaAdapter,
    private readonly notifications: NotificationService,
    private readonly heating?: HeatingScheduleSource,
    options: SpaHealthMonitorOptions = {}
  ) {
    this.offlineAfterMs = Math.max(1_000, options.offlineAfterMs ?? DEFAULT_OFFLINE_AFTER_MS);
    this.staleAfterMs = Math.max(1_000, options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
    this.checkIntervalMs = Math.max(1_000, options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS);
    this.now = options.now || (() => Date.now());
  }

  getStatus() {
    return {
      state: this.state,
      lastSuccessfulContactAt: this.lastSuccessfulContactAt || undefined,
      suspectSince: this.suspectSince || undefined,
      offlineAfterMs: this.offlineAfterMs,
      staleAfterMs: this.staleAfterMs,
      checkIntervalMs: this.checkIntervalMs
    };
  }

  start() {
    if (this.timer) return;
    void this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), this.checkIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  observeStatus(status: SpaStatus, observedAt = this.now()) {
    return this.enqueue(() => this.handleStatus(status, observedAt));
  }

  observeConnection(connected: boolean, observedAt = this.now()) {
    return this.enqueue(async () => {
      if (connected) {
        await this.markOnline(observedAt);
      } else {
        await this.markFailure(observedAt);
      }
    });
  }

  checkNow(now = this.now()) {
    return this.enqueue(async () => {
      if (this.state === 'online' && this.lastSuccessfulContactAt && now - this.lastSuccessfulContactAt < this.staleAfterMs) return;
      try {
        const status = await this.spa.getStatus();
        await this.handleStatus(status, now);
      } catch {
        await this.markFailure(now);
      }
    });
  }

  private enqueue<T>(work: () => Promise<T>) {
    const result = this.operation.then(work, work);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async handleStatus(status: SpaStatus, observedAt: number) {
    if (status.connected) {
      const contactAt = Number.isFinite(status.lastContactAt) ? Number(status.lastContactAt) : observedAt;
      await this.markOnline(contactAt);
      return;
    }

    if (Number.isFinite(status.lastContactAt)) {
      this.lastSuccessfulContactAt = Math.max(this.lastSuccessfulContactAt, Number(status.lastContactAt));
    }
    await this.markFailure(observedAt);
  }

  private async markOnline(observedAt: number) {
    const wasOffline = this.state === 'offline';
    this.lastSuccessfulContactAt = Math.max(this.lastSuccessfulContactAt, observedAt);
    this.state = 'online';
    this.suspectSince = 0;
    if (wasOffline) await this.notifications.resolveIncident(INCIDENT_KEY, 'spa_reconnected');
  }

  private async markFailure(observedAt: number) {
    if (this.state === 'online') {
      this.state = 'suspect';
      this.suspectSince = this.lastSuccessfulContactAt || observedAt;
    }
    if (!this.suspectSince) this.suspectSince = observedAt;

    if (observedAt - this.suspectSince < this.offlineAfterMs) return;
    this.state = 'offline';
    await this.publishOfflineIncident(observedAt);
  }

  private async publishOfflineIncident(now: number) {
    const lastContactAt = this.lastSuccessfulContactAt || this.suspectSince;
    const schedule = await this.relevantHeatingSchedule(now);
    const heatingDue = Boolean(schedule && schedule.startTime <= now);
    const heatingRunning = Boolean(schedule && ['running-remote', 'running-manual'].includes(schedule.status));
    const urgent = heatingDue || heatingRunning;

    let title = 'Hot tub is offline';
    let message = `Spararama has not been able to contact the hot tub since ${timeText(lastContactAt)}.`;
    if (schedule) {
      if (urgent) {
        title = heatingRunning ? 'Heating connection lost - hot tub is offline' : 'Heating cannot start - hot tub is offline';
        message += ` The planned ${timeText(schedule.targetTime)} ready time is at risk.`;
      } else {
        message += ` Heating is planned for ${timeText(schedule.startTime)} for a ${timeText(schedule.targetTime)} bath.`;
      }
    }

    await this.notifications.publish({
      type: 'equipment.spa_offline',
      group: 'equipment',
      severity: urgent ? 'urgent' : 'warning',
      title,
      message,
      incidentKey: INCIDENT_KEY,
      context: {
        healthState: this.state,
        lastContactAt,
        offlineSince: this.suspectSince,
        ...(schedule ? {
          heatingScheduleId: schedule.id,
          heatingStartTime: schedule.startTime,
          heatingTargetTime: schedule.targetTime,
          heatingStatus: schedule.status
        } : {})
      }
    });
  }

  private async relevantHeatingSchedule(now: number) {
    if (!this.heating) return undefined;
    const schedules = await this.heating.listSchedules();
    return schedules
      .filter(schedule => !['ready', 'cancelled'].includes(schedule.status) && schedule.targetTime >= now)
      .sort((a, b) => a.startTime - b.startTime)[0];
  }
}
