import os from 'node:os';
import type { SpaAdapter, SpaStatus } from '../spa/types';
import { LocalTelemetryStore } from './local-store';
import { FirebaseTelemetrySink } from './firebase-sink';
import type { TelemetryCollectorStatus, TelemetrySample } from './types';

interface TelemetrySink {
  enabled: boolean;
  config?: {
    projectId: string;
    databaseId: string;
    credentialSource: string;
  };
  writeSamples(samples: TelemetrySample[]): Promise<void>;
}

function safeHostId() {
  return (process.env.TELEMETRY_HOST_ID || os.hostname() || 'spararama-host')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 120);
}

function changedFields(previous: SpaStatus | null, current: SpaStatus) {
  if (!previous) return ['initial'];
  const fields: Array<keyof SpaStatus> = [
    'connected',
    'waterTemperatureC',
    'targetTemperatureC',
    'heaterOn',
    'filterOn',
    'bubblesOn',
    'transport'
  ];
  return fields.filter(field => !Object.is(previous[field], current[field])).map(String);
}

export class TelemetryCollector {
  private intervalMs: number;
  private readonly hostId = safeHostId();
  private readonly collectorVersion = process.env.SPARARAMA_COLLECTOR_VERSION || '0.1.0';
  private timer: NodeJS.Timeout | null = null;
  private operation = Promise.resolve();
  private previousSpa: SpaStatus | null = null;
  private status: TelemetryCollectorStatus;

  constructor(
    private readonly spa: SpaAdapter,
    private readonly store = new LocalTelemetryStore(),
    private readonly firebase: TelemetrySink = new FirebaseTelemetrySink()
  ) {
    const configured = Number(process.env.TELEMETRY_INTERVAL_SECONDS || 300);
    this.intervalMs = Math.max(60, Number.isFinite(configured) ? configured : 300) * 1000;
    this.status = {
      running: false,
      intervalMs: this.intervalMs,
      samplesCollected: 0,
      pendingUploads: 0,
      localArchivePath: this.store.archivePath,
      firebaseEnabled: this.firebase.enabled,
      firebaseProjectId: this.firebase.config?.projectId,
      firestoreDatabaseId: this.firebase.config?.databaseId,
      firebaseCredentialSource: this.firebase.config?.credentialSource
    };
  }

  start() {
    if (this.timer) return;
    this.status.running = true;
    void this.collectNow();
    this.schedule();
  }

  private schedule() {
    this.timer = setInterval(() => void this.collectNow(), this.intervalMs);
    this.timer.unref?.();
  }

  setIntervalSeconds(intervalSeconds: number) {
    this.intervalMs = intervalSeconds * 1000;
    this.status.intervalMs = this.intervalMs;
    if (this.timer) {
      clearInterval(this.timer);
      this.schedule();
    }
    return this.getStatus();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.running = false;
  }

  getStatus() {
    return { ...this.status };
  }

  readRecentSamples(limit?: number) {
    return this.store.readRecent(limit);
  }

  collectNow() {
    const result = this.operation.then(() => this.collectAndFlush(), () => this.collectAndFlush());
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async collectAndFlush() {
    try {
      const spa = await this.spa.getStatus();
      const sample: TelemetrySample = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        hostId: this.hostId,
        collectorVersion: this.collectorVersion,
        spa,
        changedFields: changedFields(this.previousSpa, spa),
        sensors: [],
        weather: []
      };
      this.previousSpa = spa;
      await this.store.append(sample);
      this.status.samplesCollected += 1;
      this.status.lastSampleAt = sample.timestamp;
      this.status.lastError = undefined;
    } catch (error: any) {
      this.status.lastError = `sample: ${error?.message || String(error)}`;
    }

    await this.flushPending();
  }

  async flushPending() {
    try {
      const pending = await this.store.readPending();
      this.status.pendingUploads = pending.length;
      if (!this.firebase.enabled || pending.length === 0) return;

      await this.firebase.writeSamples(pending);
      await this.store.acknowledgePending(pending.map(sample => sample.id));
      this.status.pendingUploads = await this.store.pendingCount();
      this.status.lastUploadAt = Date.now();
      this.status.lastError = undefined;
    } catch (error: any) {
      this.status.lastError = `upload: ${error?.message || String(error)}`;
      try {
        this.status.pendingUploads = await this.store.pendingCount();
      } catch {
        // Preserve the original upload/queue error as the actionable status.
      }
    }
  }
}
