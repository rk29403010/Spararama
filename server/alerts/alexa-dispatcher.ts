import fs from 'node:fs/promises';
import path from 'node:path';
import { NotificationPreferenceStore } from '../notifications/preferences';
import { NotificationStore } from '../notifications/store';
import type { NotificationDelivery, SpararamaNotification } from '../notifications/types';
import { VoiceMonkeyService, type VoiceMonkeySettingsInput } from './voice-monkey';

const POLL_INTERVAL_MS = 10_000;
const MAX_NOTIFICATION_AGE_MS = 30 * 60_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;
const MAX_RETRY_ATTEMPTS = 12;
const ALEXA_TARGET_ID = 'household-alexa';

interface DeliveryState {
  sentKeys: string[];
}

function alexaSpeech(notification: SpararamaNotification) {
  switch (notification.type) {
    case 'heating.target_reached':
      return 'Hot tub temperature reached.';
    case 'heating.ready':
      return 'Your hot tub is ready!';
    case 'heating.auto_start_failed':
    case 'heating.manual_start_required':
      return 'Hot tub heating needs attention.';
    case 'equipment.spa_offline':
      return notification.severity === 'urgent'
        ? 'The hot tub is offline and scheduled heating is at risk.'
        : 'The hot tub appears to be offline.';
    default:
      return null;
  }
}

function deliveryKey(notification: SpararamaNotification) {
  return [notification.id, notification.type, notification.severity, notification.title, notification.message].join('|');
}

export class AlexaAlertDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();
  private readonly retries = new Map<string, { attempts: number; nextAttemptAt: number }>();
  private readonly statePath: string;

  constructor(
    private readonly notificationStore = new NotificationStore(),
    private readonly preferences = new NotificationPreferenceStore(),
    private readonly voiceMonkey = new VoiceMonkeyService(),
    stateDir = process.env.ALERT_DELIVERY_DIR || path.join(process.cwd(), 'data', 'alerts')
  ) {
    this.statePath = path.join(stateDir, 'alexa.json');
  }

  status() { return this.voiceMonkey.status(); }
  configure(input: VoiceMonkeySettingsInput) { return this.voiceMonkey.configure(input); }
  listSpeakers(candidateToken?: string) { return this.voiceMonkey.listSpeakers(candidateToken); }
  announce(text: string) { return this.voiceMonkey.announce(text); }

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
      return { sentKeys: Array.isArray(parsed?.sentKeys) ? parsed.sentKeys : [] };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { sentKeys: [] };
      throw error;
    }
  }

  private async saveDeliveryState(state: DeliveryState) {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, this.statePath);
  }

  private retryAt(attempts: number, now: number) {
    return now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, attempts - 1)));
  }

  private async recordDelivery(
    notification: SpararamaNotification,
    attemptNumber: number,
    now: number,
    success: boolean,
    errorMessage?: string
  ) {
    const retryable = !success && attemptNumber < MAX_RETRY_ATTEMPTS;
    const record: NotificationDelivery = {
      id: crypto.randomUUID(),
      notificationId: notification.id,
      route: 'alexa',
      targetId: ALEXA_TARGET_ID,
      targetLabel: 'Alexa / Voice Monkey',
      status: success ? 'provider_accepted' : 'failed',
      attemptNumber,
      attemptedAt: now,
      ...(success ? { providerAcceptedAt: now } : {}),
      ...(!success ? {
        retryable,
        ...(retryable ? { nextAttemptAt: this.retryAt(attemptNumber, now) } : {}),
        errorCode: 'alexa_announcement_failed',
        errorMessage: errorMessage || 'Voice Monkey did not accept the Alexa announcement.'
      } : {})
    };
    await this.notificationStore.appendDelivery(record);
    return record;
  }

  private async processInternal(now: number) {
    const status = await this.voiceMonkey.status();
    if (!status.enabled || !status.configured) return;

    const notificationState = await this.notificationStore.load();
    const delivery = await this.loadDeliveryState();
    const sent = new Set(delivery.sentKeys);
    let changed = false;

    for (const notification of notificationState.notifications) {
      if (notification.resolvedAt || notification.deliverySuppressed) continue;
      const speech = alexaSpeech(notification);
      if (!speech) continue;
      if (!(await this.preferences.alexaEnabled(notification.group))) continue;
      if (notification.expiresAt && notification.expiresAt <= now) continue;
      if (now - notification.createdAt > MAX_NOTIFICATION_AGE_MS && notification.severity !== 'urgent') continue;

      const key = deliveryKey(notification);
      if (sent.has(key)) continue;
      const retry = this.retries.get(key);
      if (retry && now < retry.nextAttemptAt) continue;
      const attemptNumber = (retry?.attempts || 0) + 1;
      if (attemptNumber > MAX_RETRY_ATTEMPTS) continue;

      try {
        const result = await this.voiceMonkey.announce(speech);
        if (result.sent) {
          await this.recordDelivery(notification, attemptNumber, now, true);
          sent.add(key);
          this.retries.delete(key);
          changed = true;
          continue;
        }

        const record = await this.recordDelivery(notification, attemptNumber, now, false);
        if (record.retryable && record.nextAttemptAt) {
          this.retries.set(key, { attempts: attemptNumber, nextAttemptAt: record.nextAttemptAt });
        } else {
          this.retries.delete(key);
        }
      } catch (error: any) {
        const record = await this.recordDelivery(
          notification,
          attemptNumber,
          now,
          false,
          error?.message || String(error)
        );
        if (record.retryable && record.nextAttemptAt) {
          this.retries.set(key, { attempts: attemptNumber, nextAttemptAt: record.nextAttemptAt });
        } else {
          this.retries.delete(key);
        }
        console.error('Alexa announcement failed:', error);
      }
    }

    if (changed) await this.saveDeliveryState({ sentKeys: Array.from(sent).slice(-1000) });
  }
}
