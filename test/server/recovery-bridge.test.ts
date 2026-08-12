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
});
