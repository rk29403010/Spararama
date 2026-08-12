import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { TelemetrySample } from './types';

export class FirebaseTelemetrySink {
  readonly enabled: boolean;
  private db: ReturnType<typeof getFirestore> | null = null;

  constructor() {
    this.enabled = String(process.env.FIREBASE_TELEMETRY_ENABLED || '').toLowerCase() === 'true';
    if (!this.enabled) return;

    const projectId = process.env.FIREBASE_PROJECT_ID || 'microprojects-481213';
    const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId });
    const databaseId = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65';
    this.db = getFirestore(app, databaseId);
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
}
