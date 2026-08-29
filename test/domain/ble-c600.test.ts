import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBleC600Bytes, decodeBleC600Frame } from '../../src/domain/bleC600Protocol';

const SAMPLE_FRAME = Uint8Array.from(Buffer.from('ffa9fc5afe73ffc0ffc4ffeefdf7fd7ffabc65fea4ddbb55', 'hex'));

test('BLE-C600 decoder reproduces published meter values', () => {
  const reading = decodeBleC600Frame(SAMPLE_FRAME);
  assert.equal(reading.ph, 8.56);
  assert.equal(reading.ec, 110);
  assert.equal(reading.tds, 55);
  assert.equal(reading.salinity, 55);
  assert.equal(reading.temperatureC, 26);
  assert.equal(reading.specificGravity, 0.999);
  assert.equal(reading.orpMv, 141);
  assert.equal(reading.batteryRaw, 3010);
  assert.equal(reading.batteryPercent, 85);
});

test('BLE-C600 decoder exposes the expected decoded frame layout', () => {
  assert.deepEqual(
    Array.from(decodeBleC600Bytes(SAMPLE_FRAME)),
    [1, 2, 11, 3, 88, 0, 110, 0, 55, 0, 55, 0, 0, 1, 4, 11, 194, 32, 3, 231, 0, 141, 17, 0]
  );
});

test('BLE-C600 decoder rejects short frames', () => {
  assert.throws(() => decodeBleC600Frame(Uint8Array.of(1, 2, 3)), /expected at least 24/i);
});
