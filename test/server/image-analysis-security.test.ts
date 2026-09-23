import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeImageDataUrl, FixedWindowRateLimiter } from '../../server/analysis/routes';

function dataUrl(mimeType: string, bytes: number[]) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

test('image analysis accepts only supported images whose content matches the declared type', () => {
  const jpeg = decodeImageDataUrl(dataUrl('image/jpeg', [0xff, 0xd8, 0xff, 0x00]), 1024);
  assert.equal(jpeg.mimeType, 'image/jpeg');
  assert.equal(jpeg.byteLength, 4);

  const png = decodeImageDataUrl(dataUrl('image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), 1024);
  assert.equal(png.mimeType, 'image/png');

  assert.throws(
    () => decodeImageDataUrl(dataUrl('image/png', [0xff, 0xd8, 0xff, 0x00]), 1024),
    /does not match/
  );
  assert.throws(
    () => decodeImageDataUrl('data:text/plain;base64,SGVsbG8=', 1024),
    /Only JPEG, PNG or WebP/
  );
});

test('image analysis enforces decoded byte limits before sending to Gemini', () => {
  const oversized = dataUrl('image/jpeg', [0xff, 0xd8, 0xff, ...new Array(20).fill(0)]);
  assert.throws(() => decodeImageDataUrl(oversized, 10), /decoded-image limit/);
});

test('image analysis fixed-window limiter rejects excess billable requests', () => {
  const limiter = new FixedWindowRateLimiter(2, 60_000);
  assert.equal(limiter.consume('user-1', 1_000).allowed, true);
  assert.equal(limiter.consume('user-1', 2_000).allowed, true);
  const blocked = limiter.consume('user-1', 3_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  assert.equal(limiter.consume('user-1', 61_001).allowed, true);
});
