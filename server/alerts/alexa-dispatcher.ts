import fs from 'node:fs/promises';
import path from 'node:path';
import { HeatingStore } from '../heating/store';
import type { HeatingNotification } from '../heating/types';
import { VoiceMonkeyService, type VoiceMonkeySettingsInput } from './voice-monkey';

const POLL_INTERVAL_MS = 10_000;
const MAX_NOTIFICATION_AGE_MS = 30 * 60_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

interface DeliveryState {
  sentNotificationIds: string[];
}

function alexaSpeech(notification: HeatingNotification) {
  if (notification.kind === 'target_reached') return 'Hot tub temperature reached.';
  if (notification.kind === 'heat_soak_complete') return 'Your hot tub is ready!';
  return null;
}

export class AlexaAlertDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();
  private readonly retries = new Map<string, { attempts: number; nextAttemptAt: number }>();
  private readonly statePath: string;

  constructor(
    private readonly heatingStore = new HeatingStore(),
    private readonly voiceMonkey = new VoiceMonkeyService(),
    stateDir = process.env.ALERT_DELIVERY_DIR || path.join(process.cwd(), 'data', 'alerts')
  ) {
    this.statePath = path.join(stateDir, 'alexa.json');
  }

  status() {
    return this.voiceMonkey.status();
  }

  configure(input: VoiceMonkeySettingsInput) {
    return this.voiceMonkey.configure(input);
  }

  announce(text: string) {
    return this.voiceMonkey.announce(text);
  }

  start() {
    if (this.timer) return;
    void this.process();
    this.timer = setInterval(() => void this.process(), POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  test() {
    return this.voiceMonkey.announce('Spararama Alexa alerts are working.');
  }

  process(now = Date.now()) {
    const next = this.operation.then(() => this.processInternal(now), () => this.processInternal(now));
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }

  private async loadDeliveryState(): Promise<DeliveryState> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      return { sentNotificationIds: Array.isArray(parsed?.sentNotificationIds) ? parsed.sentNotificationIds : [] };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { sentNotificationIds: [] };
      throw error;
    }
  }

  private async saveDeliveryState(state: DeliveryState) {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, this.statePath);
  }

  private async processInternal(now: number) {
    if (!(await this.voiceMonkey.status()).configured) return;

    const heating = await this.heatingStore.load();
    const delivery = await this.loadDeliveryState();
    const sent = new Set(delivery.sentNotificationIds);
    let changed = false;

    for (const notification of heating.notifications) {
      const speech = alexaSpeech(notification);
      if (!speech || sent.has(notification.id)) continue;
      if (now - notification.createdAt > MAX_NOTIFICATION_AGE_MS) continue;

      const retry = this.retries.get(notification.id);
      if (retry && now < retry.nextAttemptAt) continue;

      try {
        const result = await this.voiceMonkey.announce(speech);
        if (!result.sent) continue;
        sent.add(notification.id);
        this.retries.delete(notification.id);
        changed = true;
      } catch (error) {
        const attempts = (retry?.attempts || 0) + 1;
        this.retries.set(notification.id, {
          attempts,
          nextAttemptAt: now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, attempts - 1)))
        });
        console.error('Alexa announcement failed:', error);
      }
    }

    if (changed) {
      await this.saveDeliveryState({ sentNotificationIds: Array.from(sent).slice(-1000) });
    }
  }
}
