import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { MerossMsh300SensorSource, resolveMerossMsh300Config } from '../../server/sensors/meross-msh300';

function reply(request: any, payload: Record<string, unknown>) {
  return new Response(JSON.stringify({
    header: { messageId: request.header.messageId, namespace: request.header.namespace, method: 'GETACK' },
    payload
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('Meross source signs local requests and maps MS100 readings', async () => {
  const requests: any[] = [];
  const source = new MerossMsh300SensorSource({
    endpoint: new URL('http://192.0.2.10/config'),
    key: 'local-device-key',
    timeoutMs: 1000,
    labels: { sensorA: 'Beside the spa' }
  }, async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    const namespace = request.header.namespace;
    if (namespace === 'Appliance.System.All') {
      return reply(request, { all: { digest: { hub: { subdevice: [
        { id: 'sensorA', status: 1, ms100: { latestTime: 1_700_000_000, latestTemperature: 215, latestHumidity: 643, voltage: 2875 } },
        { id: 'sleepingSensor', status: 2 }
      ] } } } });
    }
    if (namespace === 'Appliance.Hub.Sensor.All') {
      assert.deepEqual(request.payload, { all: [{ id: 'sensorA' }, { id: 'sleepingSensor' }] });
      return reply(request, { all: [{
        id: 'sensorA', online: { status: 1 },
        temperature: { latest: 216, latestSampleTime: 1_700_000_010 },
        humidity: { latest: 641, latestSampleTime: 1_700_000_010 }
      }, { id: 'sleepingSensor', online: { status: 2 } }] });
    }
    if (namespace === 'Appliance.Hub.Battery') {
      return reply(request, { battery: [{ id: 'sensorA', value: 87 }] });
    }
    throw new Error(`Unexpected namespace ${namespace}`);
  });

  const readings = await source.read();
  assert.equal(requests.length, 3);
  for (const request of requests) {
    const expected = createHash('md5')
      .update(`${request.header.messageId}local-device-key${request.header.timestamp}`)
      .digest('hex');
    assert.equal(request.header.sign, expected);
    assert.equal(request.header.method, 'GET');
  }
  assert.deepEqual(readings.map(reading => [reading.kind, reading.value, reading.unit]), [
    ['temperature', 21.6, 'C'],
    ['humidity', 64.1, '%'],
    ['battery', 87, '%'],
    ['battery_voltage', 2875, 'mV'],
    ['connectivity', true, undefined],
    ['connectivity', false, undefined]
  ]);
  assert.ok(readings.filter(reading => reading.deviceId === 'sensorA').every(reading => reading.location === 'Beside the spa'));
  assert.ok(readings.filter(reading => reading.deviceId === 'sensorA').every(reading => reading.observedAt === 1_700_000_010_000));
});

test('Meross source keeps temperature and humidity when battery polling is unsupported', async () => {
  const source = new MerossMsh300SensorSource({
    endpoint: new URL('http://192.0.2.10/config'), key: '', timeoutMs: 1000, labels: {}
  }, async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.header.namespace === 'Appliance.System.All') {
      return reply(request, { all: { digest: { hub: { subdevice: [{ id: 'sensorB', tempHum: {} }] } } } });
    }
    if (request.header.namespace === 'Appliance.Hub.Sensor.All') {
      return reply(request, { all: [{ id: 'sensorB', tempHum: { latestTemperature: 190, latestHumidity: 500, syncedTime: 1_700_000_100 } }] });
    }
    return new Response(JSON.stringify({
      header: { messageId: request.header.messageId, namespace: request.header.namespace, method: 'ERROR' },
      payload: { error: { code: 5002 } }
    }), { status: 200 });
  }, () => {});

  const readings = await source.read();
  assert.deepEqual(readings.map(reading => [reading.kind, reading.value]), [
    ['temperature', 19], ['humidity', 50]
  ]);
});

test('Meross source reports a specific error for an invalid device key', async () => {
  const source = new MerossMsh300SensorSource({
    endpoint: new URL('http://192.0.2.10/config'), key: 'wrong', timeoutMs: 1000, labels: {}
  }, async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      header: { messageId: request.header.messageId, namespace: request.header.namespace, method: 'ERROR' },
      payload: { error: { code: 5001 } }
    }), { status: 200 });
  });
  await assert.rejects(source.read(), /rejected the configured device key/);
});

test('Meross source uses the HTTP reply-key challenge when no account key is configured', async () => {
  const requests: any[] = [];
  const responseHeader = (request: any) => ({
    messageId: request.header.messageId,
    namespace: request.header.namespace,
    method: 'GETACK',
    timestamp: 1_700_000_200,
    sign: 'opaque-device-signature'
  });
  const source = new MerossMsh300SensorSource({
    endpoint: new URL('http://192.0.2.10/config'), key: '', timeoutMs: 1000, labels: {}
  }, async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        header: { messageId: 'device-challenge', timestamp: 1_700_000_199, sign: 'device-challenge-signature' },
        payload: { error: { code: 5001 } }
      }), { status: 200 });
    }
    if (request.header.namespace === 'Appliance.System.All') {
      assert.equal(request.header.messageId, 'device-challenge');
      assert.equal(request.header.sign, 'device-challenge-signature');
      return new Response(JSON.stringify({
        header: responseHeader(request),
        payload: { all: { digest: { hub: { subdevice: [{ id: 'sensorC', ms100: {} }] } } } }
      }), { status: 200 });
    }
    if (request.header.namespace === 'Appliance.Hub.Sensor.All') {
      assert.equal(request.header.sign, 'opaque-device-signature');
      return new Response(JSON.stringify({
        header: responseHeader(request),
        payload: { all: [{ id: 'sensorC', temperature: { latest: 201 }, humidity: { latest: 555 }, online: { status: 1 } }] }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      header: responseHeader(request), payload: { battery: [{ id: 'sensorC', value: 75 }] }
    }), { status: 200 });
  });

  const readings = await source.read();
  assert.equal(requests.length, 4);
  assert.deepEqual(readings.map(reading => [reading.kind, reading.value]), [
    ['temperature', 20.1], ['humidity', 55.5], ['battery', 75], ['connectivity', true]
  ]);
});

test('Meross configuration remains disabled without a hub and rejects unsafe endpoint paths', () => {
  assert.equal(resolveMerossMsh300Config({}), undefined);
  const config = resolveMerossMsh300Config({
    MEROSS_MSH300_HOST: '192.168.0.50',
    MEROSS_MSH300_KEY: 'secret',
    MEROSS_MS100_LABELS_JSON: '{"sensorA":"Garden"}'
  });
  assert.equal(config?.endpoint.href, 'http://192.168.0.50/config');
  assert.equal(config?.labels.sensorA, 'Garden');
  assert.throws(() => resolveMerossMsh300Config({ MEROSS_MSH300_HOST: 'http://example.test/private' }), /arbitrary path/);
});
