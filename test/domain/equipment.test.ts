import assert from 'node:assert/strict';
import test from 'node:test';
import { EQUIPMENT_CATALOG_SEED, resolveEquipmentVolumeLiters } from '../../src/domain/equipmentCatalog';
import { volumeAdjustedHeatingRate } from '../../src/domain/heating';

test('catalogue contains both spas and pools with published capacities', () => {
  assert.ok(EQUIPMENT_CATALOG_SEED.some(model => model.kind === 'spa' && (model.capacityLiters || 0) > 0));
  assert.ok(EQUIPMENT_CATALOG_SEED.some(model => model.kind === 'pool' && (model.capacityLiters || 0) > 0));
});

test('manual volume overrides model capacity', () => {
  const model = EQUIPMENT_CATALOG_SEED.find(item => item.id === 'bestway-layzspa-madeira-airjet-60109');
  assert.equal(resolveEquipmentVolumeLiters(model, undefined, 800), 778);
  assert.equal(resolveEquipmentVolumeLiters(model, 700, 800), 700);
});

test('heating rate scales inversely with water volume', () => {
  assert.equal(volumeAdjustedHeatingRate(1.5, 800, 800), 1.5);
  assert.equal(volumeAdjustedHeatingRate(1.5, 1600, 800), 0.75);
  assert.equal(volumeAdjustedHeatingRate(1.5, 400, 800), 3);
});
