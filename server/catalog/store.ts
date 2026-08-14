import { getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  EQUIPMENT_CATALOG_SEED,
  EQUIPMENT_CATALOG_VERSION,
  type EquipmentCatalogModel,
  type EquipmentCatalogResponse
} from '../../src/domain/equipmentCatalog';
import type { WaterBodyKind } from '../../src/domain/models';

const DEFAULT_DATABASE_ID = 'ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65';
const TELEMETRY_APP_NAME = 'spararama-telemetry';

export class EquipmentCatalogStore {
  private firestore() {
    const enabled = String(process.env.FIREBASE_TELEMETRY_ENABLED || '').toLowerCase() === 'true';
    if (!enabled) return null;
    const app = getApps().find(candidate => candidate.name === TELEMETRY_APP_NAME);
    if (!app) return null;
    const databaseId = process.env.FIRESTORE_DATABASE_ID || DEFAULT_DATABASE_ID;
    return getFirestore(app, databaseId);
  }

  async syncSeed() {
    const db = this.firestore();
    if (!db) return { enabled: false, count: 0 };

    const batch = db.batch();
    for (const model of EQUIPMENT_CATALOG_SEED) {
      const ref = db.collection('equipmentCatalog').doc(model.id);
      batch.set(ref, {
        ...model,
        catalogVersion: EQUIPMENT_CATALOG_VERSION,
        seededAt: Date.now()
      }, { merge: true });
    }
    await batch.commit();
    return { enabled: true, count: EQUIPMENT_CATALOG_SEED.length };
  }

  async list(kind?: WaterBodyKind): Promise<EquipmentCatalogResponse> {
    const db = this.firestore();
    if (db) {
      try {
        const snapshot = await db.collection('equipmentCatalog').get();
        const models = snapshot.docs
          .map(doc => doc.data() as EquipmentCatalogModel)
          .filter(model => model && typeof model.id === 'string');
        if (models.length > 0) {
          return { source: 'firestore', models: this.filterByKind(models, kind) };
        }
      } catch (error) {
        console.warn('Equipment catalogue Firestore read failed; using bundled seed.', error);
      }
    }

    return {
      source: 'seed',
      models: this.filterByKind(EQUIPMENT_CATALOG_SEED, kind)
    };
  }

  private filterByKind(models: EquipmentCatalogModel[], kind?: WaterBodyKind) {
    return (kind ? models.filter(model => model.kind === kind) : [...models])
      .sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model));
  }
}
