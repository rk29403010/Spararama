import { PushService } from '../push/service';
import type { SpaAdapter } from '../spa/types';
import { HeatingStore } from './store';
import type { HeatingNotification, HeatingSchedule } from './types';

const RETRY_DELAY_MS = 20_000;
const MAX_ATTEMPTS = 3;
const PUSH_RETRY_BASE_MS = 30_000;
const PUSH_RETRY_MAX_MS = 15 * 60_000;
const TARGET_HOLD_TOLERANCE_C = 0.5;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function scheduleHeatSoakMinutes(schedule: HeatingSchedule) {
  return finiteNumber(schedule.heatSoakMinutes) ? Math.max(0, schedule.heatSoakMinutes) : 0;
}

function readyTimeText(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function nextPushRetryDelay(attempts: number) {
  return Math.min(PUSH_RETRY_MAX_MS, PUSH_RETRY_BASE_MS * (2 ** Math.max(0, attempts - 1)));
}

export class HeatingScheduler {
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();

  constructor(
    private readonly spa: SpaAdapter,
    private readonly store = new HeatingStore(),
    private readonly push: PushService = new PushService()
  ) {}

  start() {
    if (this.timer) return;
    void this.processDue();
    this.timer = setInterval(() => void this.processDue(), 10_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async createSchedule(input: {
    id?: string;
    startTime: number;
    targetTime: number;
    startTemperatureC: number;
    targetTemperatureC: number;
    autoStartPreferred: boolean;
    heatSoakMinutes?: number;
    alertOnTargetReached?: boolean;
    alertOnHeatSoakComplete?: boolean;
    sessionData?: Record<string, unknown>;
  }) {
    if (![input.startTime, input.targetTime, input.startTemperatureC, input.targetTemperatureC].every(finiteNumber)) {
      throw new Error('Heating schedule requires valid start/target times and temperatures.');
    }
    if (input.targetTime <= Date.now()) throw new Error('Heating target time must be in the future.');
    const now = Date.now();
    const schedule: HeatingSchedule = {
      id: input.id || crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      startTime: input.startTime,
      targetTime: input.targetTime,
      startTemperatureC: input.startTemperatureC,
      targetTemperatureC: input.targetTemperatureC,
      autoStartPreferred: Boolean(input.autoStartPreferred),
      heatSoakMinutes: Math.max(0, finiteNumber(input.heatSoakMinutes) ? input.heatSoakMinutes : 0),
      alertOnTargetReached: input.alertOnTargetReached !== false,
      alertOnHeatSoakComplete: input.alertOnHeatSoakComplete !== false,
      status: 'scheduled',
      attempts: 0,
      sessionData: input.sessionData
    };
    const state = await this.store.load();
    state.schedules = state.schedules.filter(item => item.id !== schedule.id);
    state.schedules.push(schedule);
    await this.store.save(state);
    await this.store.appendEvent({
      id: crypto.randomUUID(),
      scheduleId: schedule.id,
      timestamp: now,
      type: 'scheduled',
      details: {
        autoStartPreferred: schedule.autoStartPreferred,
        startTime: schedule.startTime,
        targetTime: schedule.targetTime,
        targetTemperatureC: schedule.targetTemperatureC,
        heatSoakMinutes: schedule.heatSoakMinutes,
        alertOnTargetReached: schedule.alertOnTargetReached,
        alertOnHeatSoakComplete: schedule.alertOnHeatSoakComplete
      }
    });
    void this.processDue();
    return schedule;
  }

  listSchedules() {
    return this.store.load().then(state => state.schedules);
  }

  async listNotifications() {
    const state = await this.store.load();
    return state.notifications.filter(item => !item.resolvedAt);
  }

  async markNotificationDelivered(id: string) {
    const state = await this.store.load();
    const notification = state.notifications.find(item => item.id === id);
    if (!notification) throw new Error('Heating notification not found.');
    const now = Date.now();
    notification.deliveredAt = notification.deliveredAt || now;
    if (!notification.requiresConfirmation) notification.resolvedAt = notification.resolvedAt || now;
    await this.store.save(state);
    return notification;
  }

  async confirmManualStart(scheduleId: string, temperatureC?: number) {
    const state = await this.store.load();
    const schedule = state.schedules.find(item => item.id === scheduleId);
    if (!schedule) throw new Error('Heating schedule not found.');
    const now = Date.now();
    schedule.status = 'running-manual';
    schedule.manualStartedAt = now;
    schedule.updatedAt = now;
    if (finiteNumber(temperatureC)) schedule.manualStartTemperatureC = temperatureC;
    for (const notification of state.notifications) {
      if (notification.scheduleId === scheduleId && notification.kind === 'manual_start_required' && !notification.resolvedAt) notification.resolvedAt = now;
    }
    await this.store.save(state);
    await this.store.appendEvent({ id: crypto.randomUUID(), scheduleId, timestamp: now, type: 'manual_started', details: { temperatureC: schedule.manualStartTemperatureC } });
    return schedule;
  }

  processDue(now = Date.now()) {
    const next = this.operation.then(() => this.processDueInternal(now), () => this.processDueInternal(now));
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }

  private async processDueInternal(now: number) {
    const state = await this.store.load();
    let changed = false;

    for (const schedule of state.schedules) {
      if (!['scheduled', 'retrying'].includes(schedule.status)) continue;
      if (now < schedule.startTime) continue;
      if (schedule.nextAttemptAt && now < schedule.nextAttemptAt) continue;

      if (!schedule.autoStartPreferred) {
        changed = this.queueManualNotification(state.notifications, schedule, now, 'This heating event is set for manual start.') || changed;
        schedule.status = 'awaiting-manual-confirmation';
        schedule.updatedAt = now;
        changed = true;
        await this.store.appendEvent({ id: crypto.randomUUID(), scheduleId: schedule.id, timestamp: now, type: 'manual_start_requested', details: { reason: 'manual_schedule' } });
        continue;
      }

      schedule.attempts += 1;
      schedule.updatedAt = now;
      changed = true;
      await this.store.appendEvent({ id: crypto.randomUUID(), scheduleId: schedule.id, timestamp: now, type: 'remote_start_attempt', details: { attempt: schedule.attempts } });

      try {
        const status = await this.spa.getStatus();
        if (!status.connected || status.transport === 'manual') throw new Error('Spa is not remotely connected.');
        await this.spa.setTargetTemperature(schedule.targetTemperatureC);
        const started = await this.spa.setHeater(true);
        if (!started.heaterOn) throw new Error('Spa did not confirm that the heater switched on.');

        schedule.status = 'running-remote';
        schedule.remoteStartedAt = now;
        schedule.nextAttemptAt = undefined;
        schedule.lastError = undefined;
        changed = this.queueNotification(state.notifications, {
          scheduleId: schedule.id,
          kind: 'heater_started',
          createdAt: now,
          title: 'Spa heating started',
          message: `Heater is on remotely. Target ${schedule.targetTemperatureC.toFixed(0)}°C by ${readyTimeText(schedule.targetTime)}.`,
          requiresConfirmation: false
        }) || changed;
        await this.store.appendEvent({ id: crypto.randomUUID(), scheduleId: schedule.id, timestamp: now, type: 'remote_started', details: { attempt: schedule.attempts, targetTemperatureC: schedule.targetTemperatureC, targetTime: schedule.targetTime } });
      } catch (error: any) {
        schedule.lastError = error?.message || String(error);
        await this.store.appendEvent({ id: crypto.randomUUID(), scheduleId: schedule.id, timestamp: now, type: 'remote_start_failed', details: { attempt: schedule.attempts, error: schedule.lastError } });
        if (schedule.attempts < MAX_ATTEMPTS) {
          schedule.status = 'retrying';
          schedule.nextAttemptAt = now + RETRY_DELAY_MS;
        } else {
          schedule.status = 'awaiting-manual-confirmation';
          schedule.nextAttemptAt = undefined;
          changed = this.queueManualNotification(state.notifications, schedule, now, `Remote start failed after ${MAX_ATTEMPTS} attempts.`) || changed;
          await this.store.appendEvent({ id: crypto.randomUUID(), scheduleId: schedule.id, timestamp: now, type: 'manual_start_requested', details: { reason: 'remote_start_failed', attempts: schedule.attempts, error: schedule.lastError } });
        }
      }
    }

    for (const schedule of state.schedules) {
      if (!['running-remote', 'running-manual'].includes(schedule.status) || schedule.heatSoakCompletedAt) continue;

      try {
        const status = await this.spa.getStatus();
        if (!status.connected || status.transport === 'manual' || !finiteNumber(status.waterTemperatureC)) continue;

        schedule.lastObservedTemperatureC = status.waterTemperatureC;
        const heatSoakMinutes = scheduleHeatSoakMinutes(schedule);
        const atTarget = status.waterTemperatureC >= schedule.targetTemperatureC;
        const holdingTarget = status.waterTemperatureC >= schedule.targetTemperatureC - TARGET_HOLD_TOLERANCE_C;

        if (!schedule.targetReachedAt && atTarget) {
          schedule.targetReachedAt = now;
          schedule.soakStartedAt = now;
          schedule.updatedAt = now;
          changed = true;
          await this.store.appendEvent({
            id: crypto.randomUUID(),
            scheduleId: schedule.id,
            timestamp: now,
            type: 'target_reached',
            details: { temperatureC: status.waterTemperatureC, targetTemperatureC: schedule.targetTemperatureC }
          });
          if (schedule.alertOnTargetReached !== false) {
            changed = this.queueNotification(state.notifications, {
              scheduleId: schedule.id,
              kind: 'target_reached',
              createdAt: now,
              title: 'Spa reached target temperature',
              message: heatSoakMinutes > 0
                ? `${status.waterTemperatureC.toFixed(1)}°C reached at ${readyTimeText(now)}. ${heatSoakMinutes} minute heat soak started.`
                : `${status.waterTemperatureC.toFixed(1)}°C reached at ${readyTimeText(now)}.`,
              requiresConfirmation: false
            }) || changed;
          }
        }

        if (!schedule.targetReachedAt) continue;

        if (!holdingTarget) {
          if (schedule.soakStartedAt !== undefined) {
            schedule.soakStartedAt = undefined;
            schedule.updatedAt = now;
            changed = true;
            await this.store.appendEvent({
              id: crypto.randomUUID(),
              scheduleId: schedule.id,
              timestamp: now,
              type: 'soak_reset',
              details: { temperatureC: status.waterTemperatureC, targetTemperatureC: schedule.targetTemperatureC }
            });
          }
          continue;
        }

        if (schedule.soakStartedAt === undefined) {
          schedule.soakStartedAt = now;
          schedule.updatedAt = now;
          changed = true;
          await this.store.appendEvent({
            id: crypto.randomUUID(),
            scheduleId: schedule.id,
            timestamp: now,
            type: 'soak_restarted',
            details: { temperatureC: status.waterTemperatureC, targetTemperatureC: schedule.targetTemperatureC }
          });
        }

        const soakDurationMs = heatSoakMinutes * 60_000;
        if (now - schedule.soakStartedAt >= soakDurationMs) {
          schedule.heatSoakCompletedAt = now;
          schedule.status = 'ready';
          schedule.updatedAt = now;
          changed = true;
          await this.store.appendEvent({
            id: crypto.randomUUID(),
            scheduleId: schedule.id,
            timestamp: now,
            type: 'heat_soak_complete',
            details: {
              temperatureC: status.waterTemperatureC,
              targetTemperatureC: schedule.targetTemperatureC,
              heatSoakMinutes
            }
          });
          if (schedule.alertOnHeatSoakComplete !== false) {
            changed = this.queueNotification(state.notifications, {
              scheduleId: schedule.id,
              kind: 'heat_soak_complete',
              createdAt: now,
              title: 'Spa heat soak complete',
              message: heatSoakMinutes > 0
                ? `The spa has held target temperature for ${heatSoakMinutes} minutes and is ready.`
                : 'The spa is at target temperature and is ready.',
              requiresConfirmation: false
            }) || changed;
          }
        }
      } catch {
        // A live temperature is optional. Keep the heating event running and retry on the next cycle.
      }
    }

    if (this.push.enabled) {
      for (const notification of state.notifications) {
        if (notification.resolvedAt || notification.pushSentAt) continue;
        if (notification.pushNextAttemptAt && now < notification.pushNextAttemptAt) continue;

        const result = await this.push.sendHeatingNotification(notification);
        if (result.targetCount === 0) continue;

        notification.pushAttempts = (notification.pushAttempts || 0) + 1;
        notification.pushLastAttemptAt = now;
        changed = true;

        if (result.successCount > 0) {
          notification.pushSentAt = now;
          notification.pushNextAttemptAt = undefined;
          notification.pushLastError = result.failureCount > 0
            ? `${result.failureCount} push target(s) failed; ${result.successCount} accepted.`
            : undefined;
        } else {
          notification.pushLastError = result.error || `${result.failureCount} push target(s) failed.`;
          if (result.retryableFailureCount > 0) {
            notification.pushNextAttemptAt = now + nextPushRetryDelay(notification.pushAttempts);
          } else {
            notification.pushNextAttemptAt = undefined;
          }
        }
      }
    }

    if (changed) await this.store.save(state);
    return state.schedules;
  }

  private queueManualNotification(notifications: HeatingNotification[], schedule: HeatingSchedule, now: number, reason: string) {
    return this.queueNotification(notifications, {
      scheduleId: schedule.id,
      kind: 'manual_start_required',
      createdAt: now,
      title: 'Turn the spa heater on',
      message: `${reason} Please switch the heater on manually, then confirm in Spararama. Target ${schedule.targetTemperatureC.toFixed(0)}°C by ${readyTimeText(schedule.targetTime)}.`,
      requiresConfirmation: true
    });
  }

  private queueNotification(notifications: HeatingNotification[], input: Omit<HeatingNotification, 'id'>) {
    if (notifications.some(item => item.scheduleId === input.scheduleId && item.kind === input.kind)) return false;
    notifications.push({ id: crypto.randomUUID(), ...input });
    return true;
  }
}
