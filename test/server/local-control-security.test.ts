import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LocalControlSessionCodec,
  isDirectLoopbackRequest,
  isLoopbackAddress
} from '../../server/security/local-control';

const NOW = 1_800_000_000_000;

test('local-control sessions are signed, role-bearing and expire', () => {
  let now = NOW;
  const codec = new LocalControlSessionCodec(Buffer.alloc(32, 7), () => now, 60_000);
  const token = codec.issue({ uid: 'user-1', email: 'user@example.com' }, 'member');
  const session = codec.verify(token);

  assert.equal(session?.uid, 'user-1');
  assert.equal(session?.email, 'user@example.com');
  assert.equal(session?.role, 'member');
  assert.equal(session?.expiresAt, NOW + 60_000);

  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(codec.verify(tampered), null);

  now = NOW + 60_001;
  assert.equal(codec.verify(token), null);
});

test('only direct, unproxied loopback requests inherit the trusted local owner role', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.20'), false);

  const direct = { socket: { remoteAddress: '127.0.0.1' }, headers: {} } as any;
  const proxied = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '192.168.1.20', 'x-forwarded-proto': 'https' }
  } as any;
  const lan = { socket: { remoteAddress: '192.168.1.20' }, headers: {} } as any;

  assert.equal(isDirectLoopbackRequest(direct), true);
  assert.equal(isDirectLoopbackRequest(proxied), false);
  assert.equal(isDirectLoopbackRequest(lan), false);
});