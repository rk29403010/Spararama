import fs from 'node:fs';
import path from 'node:path';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { TelemetrySample } from './types';

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

  async writeSamples(samples: TelemetrySample[]) {
    if (!this.enabled || !this.db || samples.length === 0) return;

    for (let offset = 0; offset < samples.length; offset += 450) {
      const batchSamples = samples.slice(offset, offset + 450);
      const batch = this.db.batch();
      for (const sample of batchSamples) {
        const ref = this.db
          .collection('telemetryCollectors')
          .doc(sample.hostId)
          .collection('samples')
          .doc(sample.id);
        batch.set(ref, sample, { merge: false });
      }
      await batch.commit();
    }
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

  async verifySampleIdempotency(sample: TelemetrySample) {
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
