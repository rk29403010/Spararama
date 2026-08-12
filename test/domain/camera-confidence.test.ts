import assert from 'node:assert/strict';
import test from 'node:test';
import { assessChemistry } from '../../src/domain/chemistry';
import { createDefaultDomainState } from '../../src/domain/defaults';

test('low-confidence camera readings can never produce a dose instruction', () => {
  const domain = createDefaultDomainState();
  const waterBody = domain.waterBodies[0];
  const assessment = assessChemistry(waterBody, domain.products, [
    { measurement: 'total_alkalinity', value: 80, source: 'camera', confidence: 0.5 },
    { measurement: 'ph', value: 7.4, source: 'camera', confidence: 0.5 },
    { measurement: 'free_chlorine', value: 0.5, source: 'camera', confidence: 0.5 }
  ]);

  assert.equal(assessment.nextAction.kind, 'retest');
  assert.ok(assessment.findings.some(finding => finding.code === 'reading_low_confidence' && finding.severity === 'error'));
});
