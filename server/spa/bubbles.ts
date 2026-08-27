import type { SpaAdapter, SpaStatus } from './types';

export interface BubbleSafetyPolicy {
  runLimitSeconds: number | null;
  cooldownSeconds: number | null;
}

export type BubblePhase = 'idle' | 'running' | 'cooldown';

export interface BubbleSessionFields {
  bubblePhase: BubblePhase;
  bubbleRunLimitSeconds: number | null;
  bubbleCooldownSeconds: number | null;
  bubbleTimingKnown: boolean;
  bubbleStartedAt?: number;
  bubbleRunEndsAt?: number;
  bubbleCooldownEndsAt?: number;
  bubbleAutoRestartEnabled: boolean;
  bubbleAutoRestartUsed: boolean;
}

export type BubbleAwareSpaStatus = SpaStatus & BubbleSessionFields;

type Announce = (text: string) => Promise<unknown>;

const TICK_MS = 5_000;

function positiveSeconds(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function bubblePolicyForAdapter(mode = process.env.SPA_ADAPTER || 'bridge'): BubbleSafetyPolicy {
  const runOverrideMinutes = Number(process.env.SPA_BUBBLE_RUN_LIMIT_MINUTES);
  const cooldownOverrideMinutes = Number(process.env.SPA_BUBBLE_COOLDOWN_MINUTES);
  const hasRunOverride = Number.isFinite(runOverrideMinutes) && runOverrideMinutes > 0;
  const hasCooldownOverride = Number.isFinite(cooldownOverrideMinutes) && cooldownOverrideMinutes >= 0;

  const normalized = mode.toLowerCase();
  const isCleverSpa = normalized === 'bridge' || normalized === 'cleverspa' || normalized === 'mock';
  return {
    runLimitSeconds: hasRunOverride ? Math.round(runOverrideMinutes * 60) : isCleverSpa ? 20 * 60 : null,
    cooldownSeconds: hasCooldownOverride ? Math.round(cooldownOverrideMinutes * 60) : isCleverSpa ? 10 * 60 : null
  };
}

export class BubbleSessionManager {
  private phase: BubblePhase = 'idle';
  private startedAt?: number;
  private runEndsAt?: number;
  private cooldownEndsAt?: number;
  private timingKnown = false;
  private autoRestartEnabled = false;
  private autoRestartUsed = false;
  private minuteWarningSent = false;
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();

  constructor(
    private readonly adapter: SpaAdapter,
    policy: BubbleSafetyPolicy,
    private readonly announce?: Announce
  ) {
    this.policy = {
      runLimitSeconds: positiveSeconds(policy.runLimitSeconds),
      cooldownSeconds: policy.cooldownSeconds === 0 ? 0 : positiveSeconds(policy.cooldownSeconds)
    };
  }

  readonly policy: BubbleSafetyPolicy;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.process(), TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async getStatus(): Promise<BubbleAwareSpaStatus> {
    const status = await this.adapter.getStatus();
    this.reconcileObservedState(status, Date.now());
    return this.decorate(status);
  }

  async connect(): Promise<BubbleAwareSpaStatus> {
    const status = this.adapter.connect ? await this.adapter.connect() : await this.adapter.getStatus();
    this.reconcileObservedState(status, Date.now());
    return this.decorate(status);
  }

  async setBubbles(on: boolean, options?: { autoRestart?: boolean }): Promise<BubbleAwareSpaStatus> {
    const now = Date.now();
    this.advanceTime(now);

    if (on) {
      if (this.phase === 'cooldown' && this.cooldownEndsAt && now < this.cooldownEndsAt) {
        const seconds = Math.max(1, Math.ceil((this.cooldownEndsAt - now) / 1000));
        throw new Error(`Bubbles are cooling down. Try again in ${seconds} seconds.`);
      }
      const status = await this.adapter.setBubbles(true);
      if (status.bubblesOn) this.beginKnownRun(now, Boolean(options?.autoRestart), false);
      return this.decorate(status);
    }

    const status = await this.adapter.setBubbles(false);
    this.clearSession();
    return this.decorate(status);
  }

  async setAutoRestart(enabled: boolean): Promise<BubbleSessionFields> {
    this.advanceTime(Date.now());
    if (this.phase === 'idle') {
      this.autoRestartEnabled = false;
      return this.fields();
    }
    if (this.autoRestartUsed) {
      this.autoRestartEnabled = false;
      return this.fields();
    }
    this.autoRestartEnabled = enabled;
    return this.fields();
  }

  process(now = Date.now()) {
    const next = this.operation.then(() => this.processInternal(now), () => this.processInternal(now));
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }

  private beginKnownRun(now: number, autoRestartEnabled: boolean, autoRestartUsed: boolean) {
    this.phase = 'running';
    this.timingKnown = this.policy.runLimitSeconds !== null;
    this.startedAt = now;
    this.runEndsAt = this.policy.runLimitSeconds === null ? undefined : now + this.policy.runLimitSeconds * 1000;
    this.cooldownEndsAt = undefined;
    this.autoRestartEnabled = autoRestartEnabled && !autoRestartUsed && this.policy.cooldownSeconds !== null;
    this.autoRestartUsed = autoRestartUsed;
    this.minuteWarningSent = false;
  }

  private beginUnknownRun() {
    this.phase = 'running';
    this.timingKnown = false;
    this.startedAt = undefined;
    this.runEndsAt = undefined;
    this.cooldownEndsAt = undefined;
    this.autoRestartEnabled = false;
    this.autoRestartUsed = false;
    this.minuteWarningSent = false;
  }

  private beginCooldown(now: number) {
    const runEndedAt = this.runEndsAt ?? now;
    const cooldownSeconds = this.policy.cooldownSeconds;
    if (cooldownSeconds === null || cooldownSeconds === 0) {
      this.clearSession();
      return;
    }
    this.phase = 'cooldown';
    this.timingKnown = true;
    this.cooldownEndsAt = runEndedAt + cooldownSeconds * 1000;
    this.minuteWarningSent = false;
  }

  private clearSession() {
    this.phase = 'idle';
    this.timingKnown = false;
    this.startedAt = undefined;
    this.runEndsAt = undefined;
    this.cooldownEndsAt = undefined;
    this.autoRestartEnabled = false;
    this.autoRestartUsed = false;
    this.minuteWarningSent = false;
  }

  private advanceTime(now: number) {
    if (this.phase === 'running' && this.runEndsAt && now >= this.runEndsAt) {
      this.beginCooldown(now);
    }
    if (this.phase === 'cooldown' && this.cooldownEndsAt && now >= this.cooldownEndsAt && !this.autoRestartEnabled) {
      this.clearSession();
    }
  }

  private reconcileObservedState(status: SpaStatus, now: number) {
    this.advanceTime(now);
    if (status.bubblesOn) {
      // A status poll can lag the firmware's safety cutoff by a few seconds. Once a
      // known run has entered its documented cooldown, keep that countdown instead
      // of converting the stale "on" observation into an untimed new session.
      if (this.phase === 'idle') this.beginUnknownRun();
      return;
    }

    if (this.phase === 'running') {
      // An early stop is treated as a manual/external stop. The safety cooldown is
      // only modelled once the documented continuous-run limit has elapsed.
      if (!this.runEndsAt || now < this.runEndsAt) this.clearSession();
      else this.beginCooldown(now);
    }
  }

  private async processInternal(now: number) {
    this.advanceTime(now);
    if (this.phase !== 'cooldown' || !this.cooldownEndsAt) return;
    const remainingMs = this.cooldownEndsAt - now;

    if (!this.minuteWarningSent && remainingMs <= 60_000 && remainingMs > 0) {
      this.minuteWarningSent = true;
      try {
        await this.announce?.('Hot tub bubbles can start again in one minute.');
      } catch (error) {
        console.error('Bubble Alexa warning failed:', error);
      }
    }

    if (remainingMs > 0) return;
    if (!this.autoRestartEnabled || this.autoRestartUsed) {
      this.clearSession();
      return;
    }

    try {
      const status = await this.adapter.setBubbles(true);
      if (!status.bubblesOn) return;
      this.beginKnownRun(now, false, true);
    } catch (error) {
      console.error('Bubble auto-restart failed:', error);
      this.autoRestartEnabled = false;
      this.clearSession();
    }
  }

  private fields(): BubbleSessionFields {
    return {
      bubblePhase: this.phase,
      bubbleRunLimitSeconds: this.policy.runLimitSeconds,
      bubbleCooldownSeconds: this.policy.cooldownSeconds,
      bubbleTimingKnown: this.timingKnown,
      ...(this.startedAt ? { bubbleStartedAt: this.startedAt } : {}),
      ...(this.runEndsAt ? { bubbleRunEndsAt: this.runEndsAt } : {}),
      ...(this.cooldownEndsAt ? { bubbleCooldownEndsAt: this.cooldownEndsAt } : {}),
      bubbleAutoRestartEnabled: this.autoRestartEnabled,
      bubbleAutoRestartUsed: this.autoRestartUsed
    };
  }

  decorate(status: SpaStatus): BubbleAwareSpaStatus {
    return { ...status, ...this.fields() };
  }
}
