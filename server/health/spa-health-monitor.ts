import type { HeatingSchedule } from '../heating/types';
import { appendSpaHistoryEvent } from '../history/spa-events';
import type { NotificationService } from '../notifications/service';
import type { SpaAdapter, SpaFaults, SpaStatus } from '../spa/types';

export type SpaHealthState = 'online' | 'suspect' | 'offline';

export interface SpaHealthAlertSuppressionSource {
  isOfflineAlertSuppressed(now?: number): Promise<boolean>;
}

export interface SpaHealthMonitorOptions {
  offlineAfterMs?: number;
  staleAfterMs?: number;
  checkIntervalMs?: number;
  now?: () => number;
  alertSuppression?: SpaHealthAlertSuppressionSource;
}

export interface HeatingScheduleSource {
  listSchedules(): Promise<HeatingSchedule[]>;
}

const DEFAULT_OFFLINE_AFTER_MS = 3 * 60_000;
const DEFAULT_STALE_AFTER_MS = 90_000;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const RELEVANT_OVERDUE_WINDOW_MS = 12 * 60 * 60_000;
const INCIDENT_KEY = 'spa-connectivity';
const FAULT_KEYS: Array<keyof SpaFaults> = ['superheat', 'undercooling', 'filterOverdue'];
const EMPTY_FAULTS: SpaFaults = { filterOverdue: false, superheat: false, undercooling: false };

const FAULT_DETAILS: Record<keyof SpaFaults, { label: string; type: string; baseTitle: string; message: string }> = {
  superheat: {
    label: 'Overheat',
    type: 'equipment.spa_superheat',
    baseTitle: 'Hot tub overheat protection triggered',
    message: 'The hot tub reports an overheat condition. Heating and remote control are blocked until it clears.'
  },
  undercooling: {
    label: 'Temperature fault',
    type: 'equipment.spa_undercooling',
    baseTitle: 'Hot tub temperature fault',
    message: 'The hot tub reports an undercooling or temperature-sensor condition. Heating and remote control are blocked until it clears.'
  },
  filterOverdue: {
    label: 'Filter warning',
    type: 'equipment.spa_filter_overdue',
    baseTitle: 'Hot tub filter warning',
    message: 'The hot tub reports that the filter is overdue. Spararama blocks remote control until the warning clears.'
  }
};

function timeText(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function normalizedFaults(status: SpaStatus): SpaFaults {
  return {
    filterOverdue: Boolean(status.faults?.filterOverdue),
    superheat: Boolean(status.faults?.superheat),
    undercooling: Boolean(status.faults?.undercooling)
  };
}

export class SpaHealthMonitor {
  private readonly offlineAfterMs: number;
  private readonly staleAfterMs: number;
  private readonly checkIntervalMs: number;
  private readonly now: () => number;
  private readonly alertSuppression?: SpaHealthAlertSuppressionSource;
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();
  private state: SpaHealthState = 'online';
  private lastSuccessfulContactAt = 0;
  private suspectSince = 0;
  private previousFaults: SpaFaults | null = null;

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
    this.alertSuppression = options.alertSuppression;
  }

  getStatus() {
    return {
      state: this.state,
      lastSuccessfulContactAt: this.lastSuccessfulContactAt || undefined,
      suspectSince: this.suspectSince || undefined,
      activeFaults: this.previousFaults || EMPTY_FAULTS,
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

  refreshAlertState(now = this.now()) {
    return this.enqueue(async () => {
      if (this.state === 'offline') await this.publishOfflineIncident(now);
      if (this.previousFaults) {
        for (const fault of FAULT_KEYS) {
          if (this.previousFaults[fault]) await this.publishFaultIncident(fault, now);
        }
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
      await this.handleFaults(status, observedAt);
      return;
    }

    if (Number.isFinite(status.lastContactAt)) {
      this.lastSuccessfulContactAt = Math.max(this.lastSuccessfulContactAt, Number(status.lastContactAt));
    }
    await this.markFailure(observedAt);
  }

  private async handleFaults(status: SpaStatus, observedAt: number) {
    const current = normalizedFaults(status);
    const previous = this.previousFaults;
    this.previousFaults = current;

    for (const fault of FAULT_KEYS) {
      const changed = previous === null ? current[fault] : previous[fault] !== current[fault];
      if (changed) {
        await this.logFaultTransition(fault, current[fault], status, observedAt);
        if (!current[fault]) {
          await this.notifications.resolveIncident(`spa-fault-${fault}`, 'spa_fault_cleared');
          continue;
        }
      }

      // Re-publishing an unchanged incident is cheap and de-duplicated by the
      // notification service. It also lets a newly-created heating schedule
      // upgrade an existing fault notice to say that the requested bath is at risk.
      if (current[fault]) await this.publishFaultIncident(fault, observedAt);
    }
  }

  private async logFaultTransition(fault: keyof SpaFaults, active: boolean, status: SpaStatus, observedAt: number) {
    const details: Record<string, unknown> = {
      fault,
      label: FAULT_DETAILS[fault].label,
      active,
      heater_on: status.heaterOn,
      filter_on: status.filterOn,
      bubbles_on: status.bubblesOn
    };
    if (Number.isFinite(status.waterTemperatureC)) details.water_temperature_c = status.waterTemperatureC;
    if (Number.isFinite(status.targetTemperatureC)) details.target_temperature_c = status.targetTemperatureC;

    try {
      await appendSpaHistoryEvent({
        schema: 'spa-event/v1',
        id: `fault-${fault}-${active ? 'started' : 'cleared'}-${observedAt}-${crypto.randomUUID()}`,
        observed_at: new Date(observedAt).toISOString(),
        time_precision: 'millisecond',
        type: 'fault',
        action: active ? 'started' : 'cleared',
        details,
        notes: active
          ? 'Automatically captured from the CleverSpa diagnostic flags.'
          : 'Automatically captured when the CleverSpa diagnostic flag cleared.',
        source: 'cleverspa_api'
      });
    } catch (error: any) {
      console.warn(`Could not append spa fault history: ${error?.message || String(error)}`);
    }
  }

  private async publishFaultIncident(fault: keyof SpaFaults, now: number) {
    const info = FAULT_DETAILS[fault];
    const schedule = await this.relevantHeatingSchedule(now);
    const heatingDue = Boolean(schedule && schedule.startTime <= now);
    const heatingRunning = Boolean(schedule && ['running-remote', 'running-manual'].includes(schedule.status));
    const targetMissed = Boolean(schedule && schedule.targetTime < now);
    const bathAtRisk = heatingDue || heatingRunning || targetMissed;
    const severity = fault === 'superheat' || bathAtRisk ? 'urgent' : 'warning';

    let title = info.baseTitle;
    let message = info.message;
    if (schedule) {
      if (bathAtRisk) {
        title = `${info.label} - ${timeText(schedule.targetTime)} bath at risk`;
        message += targetMissed
          ? ` The planned ${timeText(schedule.targetTime)} ready time has passed.`
          : ` The planned ${timeText(schedule.targetTime)} ready time is at risk.`;
      } else {
        message += ` Heating is planned for ${timeText(schedule.startTime)} for a ${timeText(schedule.targetTime)} bath; the fault needs to clear before Spararama can control the tub.`;
      }
    }

    await this.notifications.publish({
      type: info.type,
      group: 'equipment',
      severity,
      title,
      message,
      incidentKey: `spa-fault-${fault}`,
      requiresAcknowledgement: severity === 'urgent',
      context: {
        fault,
        ...(schedule ? {
          heatingScheduleId: schedule.id,
          heatingStartTime: schedule.startTime,
          heatingTargetTime: schedule.targetTime,
          heatingStatus: schedule.status,
          heatingTargetMissed: targetMissed,
          bathingTimeAtRisk: bathAtRisk
        } : {})
      }
    });
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
    const targetMissed = Boolean(schedule && schedule.targetTime < now);
    const urgent = heatingDue || heatingRunning || targetMissed;
    const deliverySuppressed = await this.alertSuppression?.isOfflineAlertSuppressed(now) || false;

    let title = 'Hot tub is offline';
    let message = `Spararama has not been able to contact the hot tub since ${timeText(lastContactAt)}.`;
    if (schedule) {
      if (urgent) {
        title = heatingRunning ? 'Heating connection lost - hot tub is offline' : 'Heating cannot start - hot tub is offline';
        message += targetMissed
          ? ` The planned ${timeText(schedule.targetTime)} ready time has passed.`
          : ` The planned ${timeText(schedule.targetTime)} ready time is at risk.`;
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
      deliverySuppressed,
      context: {
        healthState: this.state,
        lastContactAt,
        offlineSince: this.suspectSince,
        deliverySuppressed,
        ...(schedule ? {
          heatingScheduleId: schedule.id,
          heatingStartTime: schedule.startTime,
          heatingTargetTime: schedule.targetTime,
          heatingStatus: schedule.status,
          heatingTargetMissed: targetMissed
        } : {})
      }
    });
  }

  private async relevantHeatingSchedule(now: number) {
    if (!this.heating) return undefined;
    const schedules = await this.heating.listSchedules();
    return schedules
      .filter(schedule =>
        !['ready', 'cancelled'].includes(schedule.status)
        && schedule.targetTime >= now - RELEVANT_OVERDUE_WINDOW_MS
      )
      .sort((a, b) => a.startTime - b.startTime)[0];
  }
}
