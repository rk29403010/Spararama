import type { Express } from 'express';
import type { WaterBodyKind } from '../../src/domain/models';
import { EquipmentCatalogStore } from './store';

export function registerCatalogRoutes(app: Express, store: EquipmentCatalogStore) {
  app.get('/api/catalog/equipment', async (req, res) => {
    try {
      const rawKind = String(req.query.kind || '').toLowerCase();
      const kind = rawKind === 'spa' || rawKind === 'pool' ? rawKind as WaterBodyKind : undefined;
      res.json(await store.list(kind));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Unable to load equipment catalogue' });
    }
  });
}
