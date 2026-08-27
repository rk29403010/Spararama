import fs from 'node:fs';
import path from 'node:path';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { StoredTelemetryRecord } from './types';

const DEFAULT_PROJECT_ID = 'microprojects-481213';
const DEFAULT_DATABASE_ID = 'ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65';
const TELEMETRY_APP_NAME = 'spararama-telemetry';

export interface FirebaseTelemetryConfig {
  enabled: boolean;
  projectId: string;
  databaseId: string;
  credentialSource: string;
}

function credentialSourceDescription() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      ? 'GOOGLE_APPLICATION_CREDENTIALS (file present)'
      : 'GOOGLE_APPLICATION_CREDENTIALS (file missing)';
  }

  const appData = process.env.APPDATA;
  const cloudSdkConfig = process.env.CLOUDSDK_CONFIG;
  const wellKnownPath = cloudSdkConfig
    ? path.join(cloudSdkConfig, 'application_default_credentials.json')
    : appData
      ? path.join(appData, 'gcloud', 'application_default_credentials.json')
      : null;
  if (wellKnownPath && fs.existsSync(wellKnownPath)) {
    return 'Google Cloud SDK application-default credentials';
  }

  return 'Application Default Credentials (environment or metadata; no local file detected)';
}

export function resolveFirebaseTelemetryConfig(): FirebaseTelemetryConfig {
  return {
    enabled: String(process.env.FIREBASE_TELEMETRY_ENABLED || '').toLowerCase() === 'true',
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
    databaseId: process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID,
    credentialSource: credentialSourceDescription()
  };
}

function serializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isStoredTelemetryRecord(value: unknown): value is StoredTelemetryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredTelemetryRecord>;
  return (record.schemaVersion === 1 || record.schemaVersion === 2)
    && typeof record.id === 'string'
    && typeof record.hostId === 'string'
    && typeof record.timestamp === 'number'
    && Number.isFinite(record.timestamp);
}

export class FirebaseTelemetrySink {
  readonly enabled: boolean;
  readonly config: FirebaseTelemetryConfig;
  private db: ReturnType<typeof getFirestore> | null = null;

  constructor() {
    this.config = resolveFirebaseTelemetryConfig();
    this.enabled = this.config.enabled;
    if (!this.enabled) return;

    const app = getApps().find(candidate => candidate.name === TELEMETRY_APP_NAME)
      || initializeApp(
        { credential: applicationDefault(), projectId: this.config.projectId },
        TELEMETRY_APP_NAME
      );
    this.db = getFirestore(app, this.config.databaseId);
  }

  async registerCollector(hostId: string, collectorVersion?: string) {
    if (!this.enabled || !this.db || !hostId) return;
    await this.db.collection('telemetryCollectors').doc(hostId).set({
      hostId,
      ...(collectorVersion ? { collectorVersion } : {}),
      lastRegisteredAt: Date.now()
    }, { merge: true });
  }

  async writeSamples(samples: StoredTelemetryRecord[]) {
    if (!this.enabled || !this.db || samples.length === 0) return;

    const latestByHost = new Map<string, StoredTelemetryRecord>();
    for (const sample of samples) latestByHost.set(sample.hostId, sample);
    await Promise.all(Array.from(latestByHost.values()).map(sample => this.registerCollector(sample.hostId, sample.collectorVersion)));

    for (let offset = 0; offset < samples.length; offset += 450) {
      const batchSamples = samples.slice(offset, offset + 450);
      const batch = this.db.batch();
      for (const sample of batchSamples) {
        const ref = this.db
          .collection('telemetryCollectors')
          .doc(sample.hostId)
          .collection('samples')
          .doc(sample.id);
        // Fresh sparse records can contain optional undefined fields in memory;
        // JSON round-tripping removes them before Firestore validation.
        batch.set(ref, serializable(sample), { merge: false });
      }
      await batch.commit();
    }
  }

  async readSamples(): Promise<StoredTelemetryRecord[]> {
    if (!this.enabled || !this.db) return [];

    let collectors = await this.db.collection('telemetryCollectors').get();
    if (collectors.empty) {
      // Upgrade path for telemetry written before collector registry documents
      // existed. Do this only when the registry is empty, then bootstrap it.
      const legacy = await this.db.collectionGroup('samples').get();
      const records = legacy.docs
        .map(doc => doc.data())
        .filter(isStoredTelemetryRecord);
      const hosts = new Map<string, string>();
      for (const record of records) hosts.set(record.hostId, record.collectorVersion);
      await Promise.all(Array.from(hosts.entries()).map(([hostId, version]) => this.registerCollector(hostId, version)));
      return records;
    }

    const snapshots = await Promise.all(collectors.docs.map(doc => doc.ref.collection('samples').get()));
    return snapshots
      .flatMap(snapshot => snapshot.docs.map(doc => doc.data()))
      .filter(isStoredTelemetryRecord);
  }

  async verifyConnectivity(diagnosticId: string) {
    if (!this.enabled || !this.db) {
      throw new Error('Firebase telemetry is disabled. Set FIREBASE_TELEMETRY_ENABLED=true before running the diagnostic.');
    }

    const ref = this.db.collection('telemetryDiagnostics').doc(diagnosticId);
    const payload = {
      diagnosticId,
      projectId: this.config.projectId,
      databaseId: this.config.databaseId,
      createdAt: Date.now()
    };
    await ref.set(payload, { merge: false });
    try {
      const snapshot = await ref.get();
      if (!snapshot.exists) throw new Error('Diagnostic document could not be read back.');
      const readBack = snapshot.data();
      if (readBack?.projectId !== this.config.projectId || readBack?.databaseId !== this.config.databaseId) {
        throw new Error('Diagnostic document target metadata did not match the resolved Firebase target.');
      }
      return { path: ref.path, projectId: this.config.projectId, databaseId: this.config.databaseId };
    } finally {
      await ref.delete();
    }
  }

  async verifySampleIdempotency(sample: StoredTelemetryRecord) {
    if (!this.enabled || !this.db) {
      throw new Error('Firebase telemetry is disabled. Set FIREBASE_TELEMETRY_ENABLED=true before running the diagnostic.');
    }

    await this.writeSamples([sample]);
    await this.writeSamples([sample]);
    const ref = this.db
      .collection('telemetryCollectors')
      .doc(sample.hostId)
      .collection('samples')
      .doc(sample.id);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.data()?.id !== sample.id) {
      throw new Error('Telemetry sample could not be read back from its deterministic document path.');
    }
    return { path: ref.path, sampleId: sample.id };
  }
}
