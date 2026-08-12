import type { SpaAdapter, SpaStatus } from './types';

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

export class RecoveryBridgeSpaAdapter implements SpaAdapter {
  private readonly baseUrl: string;
  private readonly token: string;
  private filterRuntimeSeconds = 0;
  private heaterRuntimeSeconds = 0;
  private lastObservedAt = Date.now();
  private lastFilterOn = false;
  private lastHeaterOn = false;
  private lastDiscoveryAttemptAt = 0;

  constructor(baseUrl = process.env.CLEVERSPA_BRIDGE_URL || 'http://127.0.0.1:8787') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = process.env.CLEVERSPA_BRIDGE_TOKEN || '';
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
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
    this.accumulateRuntime(filterOn, heaterOn);
    return {
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
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).getTime() : Date.now()
    };
  }

  private disconnectedStatus(): SpaStatus {
    this.accumulateRuntime(false, false);
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
      updatedAt: Date.now()
    };
  }

  private async discoverIfNeeded() {
    const now = Date.now();
    if (now - this.lastDiscoveryAttemptAt < 60_000) return;
    this.lastDiscoveryAttemptAt = now;
    await this.request('/api/discover', { method: 'POST', body: '{}' });
  }

  async getStatus(): Promise<SpaStatus> {
    try {
      let raw = await this.request<RecoveryStatus>('/api/status');
      if (!raw.connected) {
        try {
          await this.discoverIfNeeded();
          raw = await this.request<RecoveryStatus>('/api/status');
        } catch {
          return this.disconnectedStatus();
        }
      }
      return this.normalize(raw);
    } catch {
      return this.disconnectedStatus();
    }
  }

  async setHeater(on: boolean): Promise<SpaStatus> {
    return this.normalize(await this.request<RecoveryStatus>('/api/control/heater', {
      method: 'POST', body: JSON.stringify({ enabled: on })
    }));
  }

  async setFilter(on: boolean): Promise<SpaStatus> {
    return this.normalize(await this.request<RecoveryStatus>('/api/control/filter', {
      method: 'POST', body: JSON.stringify({ enabled: on })
    }));
  }

  async setBubbles(on: boolean): Promise<SpaStatus> {
    return this.normalize(await this.request<RecoveryStatus>('/api/control/bubbles', {
      method: 'POST', body: JSON.stringify({ enabled: on })
    }));
  }

  async setTargetTemperature(celsius: number): Promise<SpaStatus> {
    return this.normalize(await this.request<RecoveryStatus>('/api/control/target-temperature', {
      method: 'POST', body: JSON.stringify({ temperature: Math.round(celsius) })
    }));
  }
}
