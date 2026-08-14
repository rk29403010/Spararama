import { EQUIPMENT_CATALOG_SEED, type EquipmentCatalogResponse } from '../domain/equipmentCatalog';
import type { WaterBodyKind } from '../domain/models';
import { telemetryApi } from './telemetryApi';

export async function fetchEquipmentCatalog(kind?: WaterBodyKind): Promise<EquipmentCatalogResponse> {
  let result: EquipmentCatalogResponse = { source: 'seed', models: [...EQUIPMENT_CATALOG_SEED] };
  try {
    const status = await telemetryApi.status();
    if (status.equipmentCatalog) result = status.equipmentCatalog;
  } catch {}
  if (kind) result = { ...result, models: result.models.filter(item => item.kind === kind) };
  return result;
}
