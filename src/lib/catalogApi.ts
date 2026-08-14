import { EQUIPMENT_CATALOG_SEED, type EquipmentCatalogResponse } from '../domain/equipmentCatalog';
import type { WaterBodyKind } from '../domain/models';

export async function fetchEquipmentCatalog(kind?: WaterBodyKind): Promise<EquipmentCatalogResponse> {
  const models = kind ? EQUIPMENT_CATALOG_SEED.filter(model => model.kind === kind) : [...EQUIPMENT_CATALOG_SEED];
  return { source: 'seed', models };
}
