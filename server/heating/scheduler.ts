import type { SpaAdapter } from '../spa/types';
import { HeatingStore } from './store';
import type { HeatingNotification, HeatingSchedule } from './types';

const RETRY_DELAY_MS = 20_000;
const MAX_ATTEMPTS = 3;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readyTimeText(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export class HeatingScheduler {
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();

  constructor(private readonly spa: SpaAdapter, private readonly store = new HeatingStore()) {}

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
      status: 'scheduled',
      attempts: 0,
      sessionData: input.sessionData
    };
    const state = await this.store.load();
    state.schedules = state.schedules.filter(item => item.id !== schedule.id);
    state.schedules.push(schedule);
    await this.store.save(state);
    await this.store.appendEvent({ id: crypto.randomUUID(), scheduleId: schedule.id, timestamp: now, type: 'scheduled', details: { autoStartPreferred: schedule.autoStartPreferred, startTime: schedule.startTime, targetTime: schedule.targetTime, targetTemperatureC: schedule.targetTemperatureC } });
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
    notification.deliveredAt = notification.deliveredAt || Date.now();
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
        this.queueManualNotification(state.notifications, schedule, now, 'This heating event is set for manual start.');
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
        this.queueNotification(state.notifications, {
          scheduleId: schedule.id,
          kind: 'heater_started',
          createdAt: now,
          title: 'Spa heating started',
          message: `Heater is on remotely. Target ${schedule.targetTemperatureC.toFixed(0)}°C by ${readyTimeText(schedule.targetTime)}.`,
          requiresConfirmation: false
        });
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
          this.queueManualNotification(state.notifications, schedule, now, `Remote start failed after ${MAX_ATTEMPTS} attempts.`);
          await this.store.appendEvent({ id: crypto.randomUUID(), scheduleId: schedule.id, timestamp: now, type: 'manual_start_requested', details: { reason: 'remote_start_failed', attempts: schedule.attempts, error: schedule.lastError } });
        }
      }
    }
    if (changed) await this.store.save(state);
    return state.schedules;
  }

  private queueManualNotification(notifications: HeatingNotification[], schedule: HeatingSchedule, now: number, reason: string) {
    this.queueNotification(notifications, {
      scheduleId: schedule.id,
      kind: 'manual_start_required',
      createdAt: now,
      title: 'Turn the spa heater on',
      message: `${reason} Please switch the heater on manually, then confirm in Spararama. Target ${schedule.targetTemperatureC.toFixed(0)}°C by ${readyTimeText(schedule.targetTime)}.`,
      requiresConfirmation: true
    });
  }

  private queueNotification(notifications: HeatingNotification[], input: Omit<HeatingNotification, 'id'>) {
    if (notifications.some(item => item.scheduleId === input.scheduleId && item.kind === input.kind && !item.resolvedAt)) return;
    notifications.push({ id: crypto.randomUUID(), ...input });
  }
}
