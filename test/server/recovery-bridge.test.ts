import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { RecoveryBridgeSpaAdapter } from '../../server/spa/recovery-bridge';

test('recovery bridge status is normalized into Spararama spa status', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        connected: true,
        transport: 'lan',
        updatedAt: new Date().toISOString(),
        currentTemperature: 32,
        targetTemperature: 38,
        heater: true,
        filter: true,
        bubbles: false,
        filterMinutes: 123
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const adapter = new RecoveryBridgeSpaAdapter(`http://127.0.0.1:${address.port}`);
    const status = await adapter.getStatus();
    assert.equal(status.connected, true);
    assert.equal(status.transport, 'lan');
    assert.equal(status.waterTemperatureC, 32);
    assert.equal(status.targetTemperatureC, 38);
    assert.equal(status.heaterOn, true);
    assert.equal(status.filterOn, true);
    assert.equal(status.deviceFilterMinutes, 123);
    assert.equal(status.contactFailureCount, 0);
    assert.ok(status.lastContactAt);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('temporary disconnect preserves the last real reading and its acquisition time', async () => {
  const acquiredAt = new Date('2026-08-14T06:15:00.000Z');
  let statusRequests = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/status') {
      statusRequests += 1;
      if (statusRequests === 1) {
        res.end(JSON.stringify({
          connected: true,
          transport: 'lan',
          updatedAt: acquiredAt.toISOString(),
          currentTemperature: 35,
          targetTemperature: 39,
          heater: true,
          filter: true,
          bubbles: false
        }));
      } else {
        res.end(JSON.stringify({ connected: false, transport: 'lan' }));
      }
      return;
    }
    if (req.url === '/api/discover') {
      res.end(JSON.stringify({ spaFound: false }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const adapter = new RecoveryBridgeSpaAdapter(`http://127.0.0.1:${address.port}`);
    const live = await adapter.getStatus();
    const stale = await adapter.getStatus();

    assert.equal(live.connected, true);
    assert.equal(stale.connected, false);
    assert.equal(stale.waterTemperatureC, 35);
    assert.equal(stale.targetTemperatureC, 39);
    assert.equal(stale.heaterOn, true);
    assert.equal(stale.filterOn, true);
    assert.equal(stale.updatedAt, acquiredAt.getTime());
    assert.equal(stale.lastContactAt, live.lastContactAt);
    assert.equal(stale.contactFailureCount, 1);
    assert.ok(statusRequests >= 4, 'failed status cycle should retry before reporting disconnected');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('unavailable recovery bridge returns disconnected status rather than throwing', async () => {
  const adapter = new RecoveryBridgeSpaAdapter('http://127.0.0.1:1');
  const status = await adapter.getStatus();
  assert.equal(status.connected, false);
  assert.equal(status.heaterOn, false);
  assert.equal(status.filterOn, false);
  assert.equal(status.updatedAt, 0);
  assert.equal(status.contactFailureCount, 1);
});
