import type { SpaAdapter, SpaAdapterEventListener, SpaStatus } from './types';

interface RecoveryStatus {
  connected?: boolean;
  transport?: string | null;
  updatedAt?: string;
  currentTemperature?: number;
  targetTemperature?: number;
  heater?: boolean;
  filter?: boolean;
  bubbles?: boolean;
  filterMinutes?: number;
}

interface BridgeEventPayload {
  observedAt?: number;
  connected?: boolean;
  status?: RecoveryStatus;
}

interface RecoveryBridgeOptions {
  requestTimeoutMs?: number;
  controlTimeoutMs?: number;
  heaterFlowWarmupMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const STATUS_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [350, 800];
const DEFAULT_REQUEST_TIMEOUT_MS = 7_000;
const DEFAULT_CONTROL_TIMEOUT_MS = 15_000;
const DEFAULT_HEATER_FLOW_WARMUP_MS = 2_000;
const HEATER_START_ATTEMPTS = 2;
const HEATER_RETRY_DELAY_MS = 3_000;

function delay(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export class RecoveryBridgeSpaAdapter implements SpaAdapter {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly requestTimeoutMs: number;
  private readonly controlTimeoutMs: number;
  private readonly heaterFlowWarmupMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private filterRuntimeSeconds = 0;
  private heaterRuntimeSeconds = 0;
  private lastObservedAt = Date.now();
  private lastFilterOn = false;
  private lastHeaterOn = false;
  private lastDiscoveryAttemptAt = 0;
  private lastGoodStatus: SpaStatus | null = null;
  private contactFailureCount = 0;

  constructor(baseUrl = process.env.CLEVERSPA_BRIDGE_URL || 'http://127.0.0.1:8787', options: RecoveryBridgeOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = process.env.CLEVERSPA_BRIDGE_TOKEN || '';
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    this.controlTimeoutMs = Math.max(this.requestTimeoutMs, options.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS);
    this.heaterFlowWarmupMs = Math.max(0, options.heaterFlowWarmupMs ?? DEFAULT_HEATER_FLOW_WARMUP_MS);
    this.sleep = options.sleep ?? delay;
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
    };
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = this.requestTimeoutMs): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(), ...(init.headers || {}) },
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `CleverSpa bridge request failed (${response.status})`);
      return body as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private accumulateRuntime(filterOn: boolean, heaterOn: boolean) {
    const now = Date.now();
    const elapsedSeconds = Math.max(0, (now - this.lastObservedAt) / 1000);
    if (this.lastFilterOn) this.filterRuntimeSeconds += elapsedSeconds;
    if (this.lastHeaterOn) this.heaterRuntimeSeconds += elapsedSeconds;
    this.lastObservedAt = now;
    this.lastFilterOn = filterOn;
    this.lastHeaterOn = heaterOn;
  }

  private normalize(raw: RecoveryStatus): SpaStatus {
    const filterOn = Boolean(raw.filter);
    const heaterOn = Boolean(raw.heater);
    const now = Date.now();
    this.accumulateRuntime(filterOn, heaterOn);
    const parsedUpdatedAt = raw.updatedAt ? new Date(raw.updatedAt).getTime() : now;
    const status: SpaStatus = {
      transport: raw.transport === 'cloud' ? 'cloud' : 'lan',
      connected: Boolean(raw.connected),
      waterTemperatureC: Number.isFinite(raw.currentTemperature) ? Number(raw.currentTemperature) : Number.NaN,
      targetTemperatureC: Number.isFinite(raw.targetTemperature) ? Number(raw.targetTemperature) : Number.NaN,
      heaterOn,
      filterOn,
      bubblesOn: Boolean(raw.bubbles),
      filterRuntimeSeconds: this.filterRuntimeSeconds,
      heaterRuntimeSeconds: this.heaterRuntimeSeconds,
      deviceFilterMinutes: Number.isFinite(raw.filterMinutes) ? Number(raw.filterMinutes) : undefined,
      updatedAt: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : now,
      lastContactAt: now,
      contactFailureCount: 0
    };
    if (status.connected) {
      this.contactFailureCount = 0;
      this.lastGoodStatus = status;
    }
    return status;
  }

  private disconnectedStatus(): SpaStatus {
    this.contactFailureCount += 1;
    this.accumulateRuntime(false, false);
    if (this.lastGoodStatus) {
      return {
        ...this.lastGoodStatus,
        connected: false,
        filterRuntimeSeconds: this.filterRuntimeSeconds,
        heaterRuntimeSeconds: this.heaterRuntimeSeconds,
        contactFailureCount: this.contactFailureCount
      };
    }
    return {
      transport: 'lan',
      connected: false,
      waterTemperatureC: Number.NaN,
      targetTemperatureC: Number.NaN,
      heaterOn: false,
      filterOn: false,
      bubblesOn: false,
      filterRuntimeSeconds: this.filterRuntimeSeconds,
      heaterRuntimeSeconds: this.heaterRuntimeSeconds,
      updatedAt: 0,
      contactFailureCount: this.contactFailureCount
    };
  }

  private async discoverIfNeeded() {
    const now = Date.now();
    if (now - this.lastDiscoveryAttemptAt < 60_000) return;
    this.lastDiscoveryAttemptAt = now;
    await this.request('/api/discover', { method: 'POST', body: '{}' });
  }

  subscribe(listener: SpaAdapterEventListener) {
    const abort = new AbortController();
    let stopped = false;

    const run = async () => {
      while (!stopped) {
        try {
          const response = await fetch(`${this.baseUrl}/api/events`, {
            headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
            signal: abort.signal
          });
          if (!response.ok || !response.body) throw new Error(`Bridge event stream failed (${response.status})`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              let eventName = '';
              let data = '';
              for (const line of frame.split(/\r?\n/)) {
                if (line.startsWith('event:')) eventName = line.slice(6).trim();
                if (line.startsWith('data:')) data += line.slice(5).trim();
              }
              if (data) {
                const payload = JSON.parse(data) as BridgeEventPayload;
                const observedAt = Number(payload.observedAt) || Date.now();
                if (eventName === 'status' && payload.status) {
                  await listener({ kind: 'status', observedAt, status: this.normalize(payload.status), source: 'bridge-event' });
                } else if (eventName === 'connection' && typeof payload.connected === 'boolean') {
                  await listener({ kind: 'connection', observedAt, connected: payload.connected, source: 'bridge-event' });
                }
              }
              boundary = buffer.indexOf('\n\n');
            }
          }
        } catch (error: any) {
          if (stopped || error?.name === 'AbortError') break;
          await delay(2_000);
        }
      }
    };
    void run();
    return () => { stopped = true; abort.abort(); };
  }

  async getStatus(): Promise<SpaStatus> {
    for (let attempt = 0; attempt < STATUS_ATTEMPTS; attempt += 1) {
      try {
        const raw = await this.request<RecoveryStatus>('/api/status');
        if (raw.connected) return this.normalize(raw);
        if (attempt === 0) {
          try { await this.discoverIfNeeded(); } catch {}
        }
      } catch {
        if (attempt === 0) {
          try { await this.discoverIfNeeded(); } catch {}
        }
      }
      if (attempt < STATUS_ATTEMPTS - 1) await delay(RETRY_DELAYS_MS[attempt] ?? 800);
    }
    return this.disconnectedStatus();
  }

  async connect(): Promise<SpaStatus> {
    try { await this.request('/api/discover', { method: 'POST', body: '{}' }); } catch {}
    return this.getStatus();
  }

  async setHeater(on: boolean): Promise<SpaStatus> {
    if (!on) {
      return this.normalize(await this.request<RecoveryStatus>(
        '/api/control/heater',
        { method: 'POST', body: JSON.stringify({ enabled: false }) },
        this.controlTimeoutMs
      ));
    }

    const before = await this.getStatus();
    if (!before.connected || before.transport === 'manual') throw new Error('Spa is not remotely connected.');

    if (!before.filterOn) {
      const filtering = await this.setFilter(true);
      if (!filtering.filterOn) throw new Error('Spa did not confirm that filtration started before heating.');
      // Do not impose a long fixed delay. Most starts should remain near-immediate;
      // this short settle covers the physical flow interlock seen on the live tub.
      if (this.heaterFlowWarmupMs > 0) await this.sleep(this.heaterFlowWarmupMs);
    }

    let lastError: unknown = new Error('Spa did not confirm that the heater switched on.');
    for (let attempt = 0; attempt < HEATER_START_ATTEMPTS; attempt += 1) {
      try {
        const started = this.normalize(await this.request<RecoveryStatus>(
          '/api/control/heater',
          { method: 'POST', body: JSON.stringify({ enabled: true }) },
          this.controlTimeoutMs
        ));
        if (started.heaterOn) return started;
        lastError = new Error('Spa did not confirm that the heater switched on.');
      } catch (error) {
        lastError = error;
      }
      if (attempt < HEATER_START_ATTEMPTS - 1) await this.sleep(HEATER_RETRY_DELAY_MS);
    }
    throw lastError;
  }

  async setFilter(on: boolean): Promise<SpaStatus> {
    return this.normalize(await this.request<RecoveryStatus>(
      '/api/control/filter',
      { method: 'POST', body: JSON.stringify({ enabled: on }) },
      this.controlTimeoutMs
    ));
  }

  async setBubbles(on: boolean): Promise<SpaStatus> {
    return this.normalize(await this.request<RecoveryStatus>(
      '/api/control/bubbles',
      { method: 'POST', body: JSON.stringify({ enabled: on }) },
      this.controlTimeoutMs
    ));
  }

  async setTargetTemperature(celsius: number): Promise<SpaStatus> {
    return this.normalize(await this.request<RecoveryStatus>(
      '/api/control/target-temperature',
      { method: 'POST', body: JSON.stringify({ temperature: Math.round(celsius) }) },
      this.controlTimeoutMs
    ));
  }
}
