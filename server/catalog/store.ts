import { getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { EQUIPMENT_CATALOG_SEED, EQUIPMENT_CATALOG_VERSION, type EquipmentCatalogModel, type EquipmentCatalogResponse } from '../../src/domain/equipmentCatalog';
import type { WaterBodyKind } from '../../src/domain/models';

const DATABASE_ID = 'ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65';

export class EquipmentCatalogStore {
  private seeded = false;

  private firestore() {
    if (String(process.env.FIREBASE_TELEMETRY_ENABLED || '').toLowerCase() !== 'true') return null;
    const app = getApps().find(item => item.name === 'spararama-telemetry');
    return app ? getFirestore(app, process.env.FIRESTORE_DATABASE_ID || DATABASE_ID) : null;
  }

  async syncSeed() {
    const db = this.firestore();
    if (!db) return { enabled: false, count: 0 };
    const batch = db.batch();
    EQUIPMENT_CATALOG_SEED.forEach(model => batch.set(db.collection('equipmentCatalog').doc(model.id), { ...model, catalogVersion: EQUIPMENT_CATALOG_VERSION }, { merge: true }));
    await batch.commit();
    this.seeded = true;
    return { enabled: true, count: EQUIPMENT_CATALOG_SEED.length };
  }

  async list(kind?: WaterBodyKind): Promise<EquipmentCatalogResponse> {
    const db = this.firestore();
    if (db) {
      try {
        if (!this.seeded) await this.syncSeed();
        const snapshot = await db.collection('equipmentCatalog').get();
        const models = snapshot.docs.map(item => item.data() as EquipmentCatalogModel);
        if (models.length) return { source: 'firestore', models: this.filter(models, kind) };
      } catch (error) {
        console.warn('Equipment catalogue database read failed; using bundled data.', error);
      }
    }
    return { source: 'seed', models: this.filter(EQUIPMENT_CATALOG_SEED, kind) };
  }

  private filter(models: EquipmentCatalogModel[], kind?: WaterBodyKind) {
    return (kind ? models.filter(model => model.kind === kind) : [...models]).sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model));
  }
}
