import type { StoredTelemetryRecord } from './types';
import { LocalTelemetryStore, materializeTelemetryRecords, mergeTelemetryRecords } from './local-store';
import { rollUpTelemetry } from './rollup';

export interface RemoteTelemetrySource {
  enabled: boolean;
  readSamples?(): Promise<StoredTelemetryRecord[]>;
}

export interface SharedTelemetryStatus {
  source: 'firebase' | 'cache' | 'local-only';
  remoteRecords: number;
  lastRefreshAt?: number;
  lastError?: string;
}

export class SharedTelemetryStore {
  private readonly refreshIntervalMs: number;
  private cachedRemote: StoredTelemetryRecord[] | null = null;
  private lastRefreshAt = 0;
  private status: SharedTelemetryStatus = { source: 'local-only', remoteRecords: 0 };
  private refreshOperation: Promise<StoredTelemetryRecord[]> | null = null;

  constructor(
    private readonly local: LocalTelemetryStore,
    private readonly remote: RemoteTelemetrySource
  ) {
    const configured = Number(process.env.SHARED_TELEMETRY_REFRESH_SECONDS || 30);
    const seconds = Number.isFinite(configured) ? Math.max(10, Math.floor(configured)) : 30;
    this.refreshIntervalMs = seconds * 1000;
  }

  getStatus(): SharedTelemetryStatus {
    return { ...this.status };
  }

  private async loadCachedRemote() {
    if (this.cachedRemote) return this.cachedRemote;
    try {
      this.cachedRemote = await this.local.readRemoteCache();
      if (this.cachedRemote.length) {
        this.status = { ...this.status, source: 'cache', remoteRecords: this.cachedRemote.length };
      }
      return this.cachedRemote;
    } catch (error: any) {
      this.status = {
        ...this.status,
        source: 'local-only',
        lastError: `cache: ${error?.message || String(error)}`
      };
      return [];
    }
  }

  private async refreshRemote(force = false): Promise<StoredTelemetryRecord[]> {
    const now = Date.now();
    if (!force && this.cachedRemote && this.lastRefreshAt && now - this.lastRefreshAt < this.refreshIntervalMs) {
      return this.cachedRemote;
    }
    if (this.refreshOperation) return this.refreshOperation;

    this.refreshOperation = (async () => {
      if (!this.remote.enabled || !this.remote.readSamples) {
        const cached = await this.loadCachedRemote();
        this.status = {
          source: cached.length ? 'cache' : 'local-only',
          remoteRecords: cached.length,
          lastRefreshAt: this.lastRefreshAt || undefined,
          lastError: undefined
        };
        return cached;
      }

      try {
        const records = mergeTelemetryRecords(await this.remote.readSamples());
        await this.local.replaceRemoteCache(records);
        this.cachedRemote = records;
        this.lastRefreshAt = Date.now();
        this.status = {
          source: 'firebase',
          remoteRecords: records.length,
          lastRefreshAt: this.lastRefreshAt,
          lastError: undefined
        };
        return records;
      } catch (error: any) {
        const cached = await this.loadCachedRemote();
        this.status = {
          source: cached.length ? 'cache' : 'local-only',
          remoteRecords: cached.length,
          lastRefreshAt: this.lastRefreshAt || undefined,
          lastError: `firebase: ${error?.message || String(error)}`
        };
        return cached;
      }
    })();

    try {
      return await this.refreshOperation;
    } finally {
      this.refreshOperation = null;
    }
  }

  async refresh() {
    await this.refreshRemote(true);
    return this.getStatus();
  }

  private async mergedRecords() {
    const [localRecords, remoteRecords] = await Promise.all([
      this.local.readArchiveRecords(),
      this.refreshRemote()
    ]);
    // Local comes last so an identical collector/id prefers its local durable copy.
    return mergeTelemetryRecords(remoteRecords, localRecords);
  }

  async readRecent(limit = 200) {
    const samples = materializeTelemetryRecords(await this.mergedRecords());
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit) || 200));
    return {
      samples: samples.slice(-safeLimit).reverse(),
      total: samples.length,
      sharedHistory: this.getStatus()
    };
  }

  async readChartRange(since: number, maxPoints = 500) {
    // Materialize all known state first so events inside the requested range can
    // inherit their collector's snapshot from before the requested window.
    const samples = materializeTelemetryRecords(await this.mergedRecords())
      .filter(sample => Number.isFinite(sample.timestamp) && sample.timestamp >= since)
      .sort((a, b) => a.timestamp - b.timestamp || a.hostId.localeCompare(b.hostId));
    const safeMax = Math.max(50, Math.min(1200, Math.floor(maxPoints) || 500));
    const rolled = rollUpTelemetry(samples, safeMax);
    return {
      samples: rolled,
      rawTotal: samples.length,
      rolledUp: rolled.length < samples.length,
      sharedHistory: this.getStatus()
    };
  }
}
