import type { WaterBodyKind } from './models';

export type SpaConnectorId = 'cleverspa';

export interface EquipmentCatalogSource {
  label: string;
  url: string;
  fields: string[];
}

export interface EquipmentCatalogModel {
  id: string;
  kind: WaterBodyKind;
  manufacturerId: string;
  manufacturer: string;
  model: string;
  capacityLiters?: number;
  wifi: boolean;
  connectorId?: SpaConnectorId;
  maxTempC?: number;
  heaterPowerWatts?: number;
  nominalHeatingRateCPerHour?: number;
  sourceQuality: 'manufacturer' | 'official_brand' | 'project_verified';
  sources: EquipmentCatalogSource[];
  notes?: string;
  checkedAt: string;
}

export interface EquipmentCatalogResponse {
  source: 'firestore' | 'seed';
  models: EquipmentCatalogModel[];
}

export const EQUIPMENT_CATALOG_VERSION = 1;

// Manufacturer/model facts below come from first-party manufacturer/brand sources.
// The current CleverSpa profile keeps the project's established 800 L capacity
// because an accessible first-party capacity specification has not yet been found;
// its Wi-Fi capability is supported by CleverSpa's official CleverLink material.
export const EQUIPMENT_CATALOG_SEED: EquipmentCatalogModel[] = [
  {
    id: 'cleverspa-current-800',
    kind: 'spa',
    manufacturerId: 'cleverspa',
    manufacturer: 'CleverSpa',
    model: 'Current 800 L Wi-Fi profile',
    capacityLiters: 800,
    wifi: true,
    connectorId: 'cleverspa',
    maxTempC: 40,
    sourceQuality: 'project_verified',
    sources: [
      {
        label: 'CleverSpa / Clever Company - CleverLink App',
        url: 'https://vimeo.com/732425958',
        fields: ['wifi']
      }
    ],
    notes: '800 L is the established capacity of the current Spararama installation. Wi-Fi is supported by the in-repo CleverSpa connector.',
    checkedAt: '2026-08-14'
  },
  {
    id: 'bestway-layzspa-madeira-airjet-60109',
    kind: 'spa',
    manufacturerId: 'bestway',
    manufacturer: 'Bestway / Lay-Z-Spa',
    model: 'Madeira AirJet 60109',
    capacityLiters: 778,
    wifi: true,
    maxTempC: 40,
    nominalHeatingRateCPerHour: 1.75,
    sourceQuality: 'manufacturer',
    sources: [
      {
        label: 'Bestway product specification',
        url: 'https://bestwaycorp.com/Product/Item?id=1060109XXX23',
        fields: ['capacityLiters', 'wifi', 'maxTempC', 'nominalHeatingRateCPerHour']
      }
    ],
    notes: 'Manufacturer gives an approximate 1.5-2.0 °C/h heating rate; catalogue midpoint is 1.75 °C/h.',
    checkedAt: '2026-08-14'
  },
  {
    id: 'bestway-layzspa-milan-airjet-plus-54184',
    kind: 'spa',
    manufacturerId: 'bestway',
    manufacturer: 'Bestway / Lay-Z-Spa',
    model: 'Milan AirJet Plus 54184',
    capacityLiters: 916,
    wifi: true,
    maxTempC: 40,
    nominalHeatingRateCPerHour: 1.75,
    sourceQuality: 'manufacturer',
    sources: [
      {
        label: 'Bestway product specification',
        url: 'https://m.bestwaycorp.com/Product/Item?id=1C54184XXX20',
        fields: ['capacityLiters', 'wifi', 'maxTempC', 'nominalHeatingRateCPerHour']
      }
    ],
    notes: 'Manufacturer gives an approximate 1.5-2.0 °C/h heating rate; catalogue midpoint is 1.75 °C/h.',
    checkedAt: '2026-08-14'
  },
  {
    id: 'intex-purespa-greywood-deluxe-6-28441',
    kind: 'spa',
    manufacturerId: 'intex',
    manufacturer: 'Intex',
    model: 'PureSpa Greywood Deluxe 6 Person 28441',
    capacityLiters: 1098,
    wifi: true,
    maxTempC: 40,
    sourceQuality: 'manufacturer',
    sources: [
      {
        label: 'Intex Greywood Deluxe product specification',
        url: 'https://intexcorp.com/products/spas/purespa/purespa-greywood-deluxe/85in-x-28in-purespa-greywood-deluxe-set/',
        fields: ['capacityLiters']
      },
      {
        label: 'Intex Greywood Deluxe product page - INTEX Link app',
        url: 'https://intexcorp.com/purespa-bubble-massage/6-person-greywood-deluxe-round-bubble-spa-set/',
        fields: ['wifi']
      }
    ],
    notes: 'Manufacturer specifies 290 US gallons; stored as approximately 1,098 L. Wi-Fi/app capable, but no Spararama Intex connector is implemented yet.',
    checkedAt: '2026-08-14'
  },
  {
    id: 'intex-prism-frame-15x48-26725',
    kind: 'pool',
    manufacturerId: 'intex',
    manufacturer: 'Intex',
    model: 'Prism Frame 15 ft x 48 in 26725',
    capacityLiters: 16807,
    wifi: false,
    sourceQuality: 'manufacturer',
    sources: [
      {
        label: 'Intex product specification',
        url: 'https://intexcorp.com/products/above-ground-pools/prism-frame/15ft-x-48in-prism-frame-pool-set/',
        fields: ['capacityLiters']
      }
    ],
    notes: 'Manufacturer specifies 4,440 US gallons at 90% fill; stored as approximately 16,807 L.',
    checkedAt: '2026-08-14'
  },
  {
    id: 'bestway-power-steel-oval-18x9x48-15159',
    kind: 'pool',
    manufacturerId: 'bestway',
    manufacturer: 'Bestway',
    model: 'Power Steel Oval 18 ft x 9 ft x 48 in 15159',
    capacityLiters: 13430,
    wifi: false,
    sourceQuality: 'manufacturer',
    sources: [
      {
        label: 'Bestway product specification',
        url: 'https://www.bestwaycorp.com/Product/Item?id=1015159XXX18',
        fields: ['capacityLiters']
      }
    ],
    checkedAt: '2026-08-14'
  },
  {
    id: 'bestway-power-steel-swim-vista-round-18x48-561ab',
    kind: 'pool',
    manufacturerId: 'bestway',
    manufacturer: 'Bestway',
    model: 'Power Steel Swim Vista Series 18 ft x 48 in 561AB',
    capacityLiters: 23062,
    wifi: false,
    sourceQuality: 'manufacturer',
    sources: [
      {
        label: 'Bestway product specification',
        url: 'https://www.bestwaycorp.com/Product/Item?id=10561ABXXX23',
        fields: ['capacityLiters']
      }
    ],
    checkedAt: '2026-08-14'
  }
];

export function equipmentModelsForKind(kind: WaterBodyKind, models = EQUIPMENT_CATALOG_SEED) {
  return models.filter(model => model.kind === kind);
}

export function resolveEquipmentVolumeLiters(
  model: EquipmentCatalogModel | undefined,
  overrideLiters: number | undefined,
  fallbackLiters: number
) {
  if (Number.isFinite(overrideLiters) && Number(overrideLiters) > 0) return Number(overrideLiters);
  if (Number.isFinite(model?.capacityLiters) && Number(model?.capacityLiters) > 0) return Number(model?.capacityLiters);
  return fallbackLiters;
}
