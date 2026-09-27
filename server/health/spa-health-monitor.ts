import type { HeatingSchedule } from '../heating/types';
import type { NotificationService } from '../notifications/service';
import type { SpaAdapter, SpaStatus } from '../spa/types';
import {
  SpaConnectivityHistoryStore,
  type SpaConnectivityLearningProfile
} from './connectivity-history';

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
  historyStore?: SpaConnectivityHistoryStore;
}

export interface HeatingScheduleSource {
  listSchedules(): Promise<HeatingSchedule[]>;
}

interface ActiveConnectivityEpisode {
  id: string;
  startedAt: number;
  failureObservations: number;
  sources: Set<string>;
  transports: Set<string>;
  maxContactFailureCount: number;
  reachedOffline: boolean;
  alertThresholdMs: number;
  heatingThreatened: boolean;
  deliverySuppressed: boolean;
  lastSuccessfulContactAt?: number;
}

const DEFAULT_OFFLINE_AFTER_MS = 3 * 60_000;
const DEFAULT_STALE_AFTER_MS = 90_000;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const RELEVANT_OVERDUE_WINDOW_MS = 12 * 60 * 60_000;
const INCIDENT_KEY = 'spa-connectivity';

function timeText(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function episodeId(startedAt: number) {
  return `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
}

export class SpaHealthMonitor {
  private readonly offlineAfterMs: number;
  private readonly staleAfterMs: number;
  private readonly checkIntervalMs: number;
  private readonly now: () => number;
  private readonly alertSuppression?: SpaHealthAlertSuppressionSource;
  private readonly historyStore?: SpaConnectivityHistoryStore;
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();
  private state: SpaHealthState = 'online';
  private lastSuccessfulContactAt = 0;
  private suspectSince = 0;
  private activeEpisode: ActiveConnectivityEpisode | null = null;
  private learningProfile: SpaConnectivityLearningProfile;

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
    this.historyStore = options.historyStore;
    this.learningProfile = {
      episodeCount: 0,
      transientSampleCount: 0,
      learnedIdleOfflineAfterMs: this.offlineAfterMs
    };
  }

  getStatus() {
    return {
      state: this.state,
      lastSuccessfulContactAt: this.lastSuccessfulContactAt || undefined,
      suspectSince: this.suspectSince || undefined,
      offlineAfterMs: this.offlineAfterMs,
      idleOfflineAfterMs: this.learningProfile.learnedIdleOfflineAfterMs,
      staleAfterMs: this.staleAfterMs,
      checkIntervalMs: this.checkIntervalMs,
      connectivityLearning: {
        enabled: Boolean(this.historyStore),
        ...this.learningProfile
      },
      currentEpisode: this.activeEpisode ? {
        startedAt: this.activeEpisode.startedAt,
        failureObservations: this.activeEpisode.failureObservations,
        sources: [...this.activeEpisode.sources],
        transports: [...this.activeEpisode.transports],
        maxContactFailureCount: this.activeEpisode.maxContactFailureCount,
        reachedOffline: this.activeEpisode.reachedOffline,
        alertThresholdMs: this.activeEpisode.alertThresholdMs
      } : undefined
    };
  }

  async getConnectivityHistory(limit = 100) {
    return {
      profile: this.learningProfile,
      episodes: this.historyStore ? await this.historyStore.listRecentEpisodes(limit) : []
    };
  }

  start() {
    if (this.timer) return;
    void this.refreshLearning().then(() => this.checkNow());
    this.timer = setInterval(() => void this.checkNow(), this.checkIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  observeStatus(status: SpaStatus, observedAt = this.now(), source = 'status') {
    return this.enqueue(() => this.handleStatus(status, observedAt, source));
  }

  observeConnection(connected: boolean, observedAt = this.now(), source = 'connection') {
    return this.enqueue(async () => {
      if (connected) {
        await this.markOnline(observedAt, source);
      } else {
        await this.markFailure(observedAt, source);
      }
    });
  }

  checkNow(now = this.now()) {
    return this.enqueue(async () => {
      if (this.state === 'online' && this.lastSuccessfulContactAt && now - this.lastSuccessfulContactAt < this.staleAfterMs) return;
      try {
        const status = await this.spa.getStatus();
        await this.handleStatus(status, now, 'watchdog');
      } catch {
        await this.markFailure(now, 'watchdog-error');
      }
    });
  }

  refreshAlertState(now = this.now()) {
    return this.enqueue(async () => {
      if (this.state === 'offline') await this.publishOfflineIncident(now);
    });
  }

  private enqueue<T>(work: () => Promise<T>) {
    const result = this.operation.then(work, work);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async handleStatus(status: SpaStatus, observedAt: number, source: string) {
    if (status.connected) {
      const contactAt = Number.isFinite(status.lastContactAt) ? Number(status.lastContactAt) : observedAt;
      await this.markOnline(contactAt, source, status);
      return;
    }

    if (Number.isFinite(status.lastContactAt)) {
      this.lastSuccessfulContactAt = Math.max(this.lastSuccessfulContactAt, Number(status.lastContactAt));
    }
    await this.markFailure(observedAt, source, status);
  }

  private async markOnline(observedAt: number, source: string, status?: SpaStatus) {
    const wasOffline = this.state === 'offline';
    const wasUnhealthy = this.state !== 'online';
    const finishedEpisode = wasUnhealthy ? this.activeEpisode : null;

    this.lastSuccessfulContactAt = Math.max(this.lastSuccessfulContactAt, observedAt);
    this.state = 'online';
    this.suspectSince = 0;
    this.activeEpisode = null;

    if (wasUnhealthy) {
      await this.recordTransition('online', observedAt, source, status, `Contact restored after ${Math.max(0, observedAt - (finishedEpisode?.startedAt || observedAt))}ms.`);
      if (finishedEpisode) await this.finishEpisode(finishedEpisode, observedAt);
    }
    if (wasOffline) await this.notifications.resolveIncident(INCIDENT_KEY, 'spa_reconnected');
  }

  private async markFailure(observedAt: number, source: string, status?: SpaStatus) {
    if (!this.activeEpisode) {
      this.activeEpisode = {
        id: episodeId(observedAt),
        startedAt: observedAt,
        failureObservations: 0,
        sources: new Set(),
        transports: new Set(),
        maxContactFailureCount: 0,
        reachedOffline: false,
        alertThresholdMs: this.offlineAfterMs,
        heatingThreatened: false,
        deliverySuppressed: false,
        lastSuccessfulContactAt: this.lastSuccessfulContactAt || undefined
      };
    }

    this.activeEpisode.failureObservations += 1;
    if (source) this.activeEpisode.sources.add(source);
    if (status?.transport) this.activeEpisode.transports.add(status.transport);
    if (Number.isFinite(status?.contactFailureCount)) {
      this.activeEpisode.maxContactFailureCount = Math.max(
        this.activeEpisode.maxContactFailureCount,
        Number(status?.contactFailureCount)
      );
    }

    if (this.state === 'online') {
      this.state = 'suspect';
      // Start the grace period when Spararama actually observes the first failure.
      // Do not backdate it to an old last-contact timestamp: an idle spa may simply
      // not have produced status traffic recently, which used to bypass the delay.
      this.suspectSince = observedAt;
      await this.recordTransition('suspect', observedAt, source, status, 'First observed contact failure.');
    }
    if (!this.suspectSince) this.suspectSince = observedAt;

    if (this.state === 'offline') {
      await this.publishOfflineIncident(observedAt);
      return;
    }

    const elapsedMs = observedAt - this.suspectSince;
    if (elapsedMs < this.offlineAfterMs) return;

    const schedule = await this.relevantHeatingSchedule(observedAt);
    const heatingThreatened = this.isHeatingThreatened(schedule, observedAt);
    const thresholdMs = heatingThreatened
      ? this.offlineAfterMs
      : Math.max(this.offlineAfterMs, this.learningProfile.learnedIdleOfflineAfterMs);
    this.activeEpisode.alertThresholdMs = thresholdMs;
    this.activeEpisode.heatingThreatened ||= heatingThreatened;

    if (elapsedMs < thresholdMs) return;

    this.state = 'offline';
    this.activeEpisode.reachedOffline = true;
    await this.recordTransition('offline', observedAt, source, status, `Contact unavailable for ${elapsedMs}ms; alert threshold ${thresholdMs}ms.`);
    await this.publishOfflineIncident(observedAt, schedule);
  }

  private async publishOfflineIncident(now: number, knownSchedule?: HeatingSchedule) {
    const lastContactAt = this.lastSuccessfulContactAt || this.suspectSince;
    const schedule = knownSchedule ?? await this.relevantHeatingSchedule(now);
    const heatingDue = Boolean(schedule && schedule.startTime <= now);
    const heatingRunning = Boolean(schedule && ['running-remote', 'running-manual'].includes(schedule.status));
    const targetMissed = Boolean(schedule && schedule.targetTime < now);
    const urgent = heatingDue || heatingRunning || targetMissed;
    const deliverySuppressed = await this.alertSuppression?.isOfflineAlertSuppressed(now) || false;

    if (this.activeEpisode) {
      this.activeEpisode.heatingThreatened ||= urgent;
      this.activeEpisode.deliverySuppressed ||= deliverySuppressed;
    }

    let title = "Hot tub can't be contacted";
    let message = `Spararama has not been able to contact the hot tub since ${timeText(lastContactAt)}.`;
    if (schedule) {
      if (urgent) {
        title = heatingRunning ? "Heating connection lost - hot tub can't be contacted" : "Heating can't start - hot tub can't be contacted";
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
        alertThresholdMs: this.activeEpisode?.alertThresholdMs || this.offlineAfterMs,
        failureObservations: this.activeEpisode?.failureObservations,
        connectivitySources: this.activeEpisode ? [...this.activeEpisode.sources] : undefined,
        connectivityTransports: this.activeEpisode ? [...this.activeEpisode.transports] : undefined,
        maxContactFailureCount: this.activeEpisode?.maxContactFailureCount,
        learnedIdleOfflineAfterMs: this.learningProfile.learnedIdleOfflineAfterMs,
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

  private isHeatingThreatened(schedule: HeatingSchedule | undefined, now: number) {
    return Boolean(schedule && (
      schedule.startTime <= now
      || ['running-remote', 'running-manual'].includes(schedule.status)
      || schedule.targetTime < now
    ));
  }

  private async finishEpisode(episode: ActiveConnectivityEpisode, endedAt: number) {
    if (!this.historyStore) return;
    try {
      await this.historyStore.appendEpisode({
        id: episode.id,
        startedAt: episode.startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - episode.startedAt),
        reachedOffline: episode.reachedOffline,
        alertThresholdMs: episode.alertThresholdMs,
        failureObservations: episode.failureObservations,
        sources: [...episode.sources],
        transports: [...episode.transports],
        maxContactFailureCount: episode.maxContactFailureCount,
        heatingThreatened: episode.heatingThreatened,
        deliverySuppressed: episode.deliverySuppressed,
        lastSuccessfulContactAt: episode.lastSuccessfulContactAt
      });
      await this.refreshLearning();
    } catch (error: any) {
      console.warn(`Could not record spa connectivity episode: ${error?.message || String(error)}`);
    }
  }

  private async recordTransition(
    state: SpaHealthState,
    at: number,
    source: string,
    status?: SpaStatus,
    detail?: string
  ) {
    if (!this.historyStore) return;
    try {
      await this.historyStore.appendEvent({
        at,
        state,
        source,
        transport: status?.transport,
        contactFailureCount: status?.contactFailureCount,
        lastSuccessfulContactAt: this.lastSuccessfulContactAt || undefined,
        suspectSince: this.suspectSince || undefined,
        thresholdMs: state === 'offline' ? this.activeEpisode?.alertThresholdMs : undefined,
        detail
      });
    } catch (error: any) {
      console.warn(`Could not record spa connectivity transition: ${error?.message || String(error)}`);
    }
  }

  private async refreshLearning() {
    if (!this.historyStore) return;
    try {
      this.learningProfile = await this.historyStore.learningProfile(this.offlineAfterMs);
    } catch (error: any) {
      console.warn(`Could not load spa connectivity learning profile: ${error?.message || String(error)}`);
    }
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
