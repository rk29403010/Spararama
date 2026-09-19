import type { HeatingScheduler } from '../heating/scheduler';
import type { BubbleSessionManager } from '../spa/bubbles';
import type { SpaAdapter } from '../spa/types';
import type { RemoteAgent } from './agent';

const DEFAULT_HEARTBEAT_SECONDS = 30;

export class RemoteSnapshotPublisher {
  private timer?: NodeJS.Timeout;
  private operation = Promise.resolve();

  constructor(
    private readonly agent: RemoteAgent,
    private readonly spa: SpaAdapter,
    private readonly bubbles?: BubbleSessionManager,
    private readonly heating?: HeatingScheduler,
    private readonly intervalMs = Math.max(
      10_000,
      Number(process.env.REMOTE_HEARTBEAT_SECONDS || DEFAULT_HEARTBEAT_SECONDS) * 1000
    )
  ) {}

  start() {
    if (this.timer) return;
    void this.publishNow();
    this.timer = setInterval(() => void this.publishNow(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  publishNow() {
    const next = this.operation.then(
      () => this.publishNowInternal(),
      () => this.publishNowInternal()
    );
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }

  private async publishNowInternal() {
    const observedAt = Date.now();
    try {
      const spa = this.bubbles ? await this.bubbles.getStatus() : await this.spa.getStatus();
      const schedules = this.heating ? await this.heating.listSchedules() : [];
      const active = schedules
        .filter(schedule => !['ready', 'cancelled'].includes(schedule.status))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];

      await this.agent.publishPresence({
        observedAt,
        agentOnline: true,
        spaConnected: spa.connected,
        spaTransport: spa.transport
      });
      await this.agent.publishState({
        observedAt,
        spa,
        ...(active ? {
          activeHeatingSchedule: {
            id: active.id,
            status: active.status,
            targetTime: active.targetTime,
            targetTemperatureC: active.targetTemperatureC
          }
        } : {}),
        capabilities: [
          'readStatus',
          'setTargetTemperature',
          'setHeater',
          'setFilter',
          'setBubbles',
          'scheduleReadyAt',
          'createHeatingSchedule'
        ]
      });
    } catch (error) {
      try {
        await this.agent.publishPresence({
          observedAt,
          agentOnline: true
        });
      } catch {
        // Remote publication failure must never interfere with local spa operation.
      }
      throw error;
    }
  }
}
