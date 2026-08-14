import type { EquipmentCatalogResponse } from '../domain/equipmentCatalog';
import type { WaterBodyKind } from '../domain/models';

export async function fetchEquipmentCatalog(kind?: WaterBodyKind): Promise<EquipmentCatalogResponse> {
  const suffix = kind ? '?kind=' + kind : '';
  const response = await fetch('/api/catalog/equipment' + suffix);
  if (!response.ok) throw new Error('Unable to load equipment catalogue');
  return response.json();
}
