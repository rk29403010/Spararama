import assert from 'node:assert/strict';
import test from 'node:test';
import { spoonDoseForProduct } from '../../src/domain/spoons';

test('alkalinity increaser rounds to a practical spoon combination', () => {
  const spoon = spoonDoseForProduct('cleverspa-ta-plus', 51);
  assert.ok(spoon);
  assert.equal(spoon.text, '3 tbsp + 1 tsp');
  assert.equal(spoon.approximateGrams, 50);
});

test('pH plus uses its powder bulk density', () => {
  const spoon = spoonDoseForProduct('cleverspa-ph-plus', 9);
  assert.ok(spoon);
  assert.equal(spoon.text, '2 tsp');
  assert.equal(spoon.approximateGrams, 10);
});

test('chlorine granules use their own approximate bulk density', () => {
  const spoon = spoonDoseForProduct('cleverspa-chlorine-granules', 6);
  assert.ok(spoon);
  assert.equal(spoon.text, '1 tsp + ½ tsp');
  assert.equal(spoon.approximateGrams, 6.8);
});

test('pH minus uses denser granular bisulfate profile', () => {
  const spoon = spoonDoseForProduct('cleverspa-ph-minus', 9);
  assert.ok(spoon);
  assert.equal(spoon.text, '1 tsp + ½ tsp');
  assert.equal(spoon.approximateGrams, 10);
});
