import assert from 'node:assert/strict';
import test from 'node:test';
import { AlexaSpaCommandService, handleAlexaDirectRequest, resolveNextAlexaTime } from '../../server/alexa/direct';
import { BubbleSessionManager } from '../../server/spa/bubbles';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';

class AlexaTestAdapter implements SpaAdapter {
  status: SpaStatus = {
    transport: 'mock',
    connected: true,
    waterTemperatureC: 35,
    targetTemperatureC: 38,
    heaterOn: false,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0,
    updatedAt: Date.now()
  };

  async getStatus() { return { ...this.status }; }
  async setHeater(on: boolean) { this.status.heaterOn = on; return this.getStatus(); }
  async setFilter(on: boolean) { this.status.filterOn = on; return this.getStatus(); }
  async setBubbles(on: boolean) { this.status.bubblesOn = on; return this.getStatus(); }
  async setTargetTemperature(celsius: number) { this.status.targetTemperatureC = celsius; return this.getStatus(); }
}

class HeatingTestScheduler {
  schedules: any[] = [];
  async createSchedule(input: any) {
    this.schedules.push(input);
    return input;
  }
}

function smartHome(namespace: string, name: string, endpointId?: string, payload: any = {}) {
  return {
    directive: {
      header: { namespace, name, correlationToken: 'test-correlation', payloadVersion: '3' },
      ...(endpointId ? { endpoint: { endpointId, scope: { type: 'BearerToken', token: 'test' } } } : {}),
      payload
    }
  };
}

function customIntent(name: string, slots: Record<string, string> = {}) {
  return {
    request: {
      type: 'IntentRequest',
      intent: {
        name,
        slots: Object.fromEntries(Object.entries(slots).map(([slotName, value]) => [slotName, { name: slotName, value }]))
      }
    }
  };
}

test('Alexa discovery exposes hot tub, bubbles and filter endpoints', async () => {
  const adapter = new AlexaTestAdapter();
  const commands = new AlexaSpaCommandService(adapter, new BubbleSessionManager(adapter, { runLimitSeconds: 1200, cooldownSeconds: 600 }), new HeatingTestScheduler());
  const response: any = await handleAlexaDirectRequest(smartHome('Alexa.Discovery', 'Discover'), commands);
  assert.deepEqual(response.event.payload.endpoints.map((endpoint: any) => endpoint.friendlyName), ['Hot Tub', 'Hot Tub Bubbles', 'Hot Tub Filter']);
});

test('Alexa bubbles command goes through BubbleSessionManager', async () => {
  const adapter = new AlexaTestAdapter();
  const bubbles = new BubbleSessionManager(adapter, { runLimitSeconds: 1200, cooldownSeconds: 600 });
  const commands = new AlexaSpaCommandService(adapter, bubbles, new HeatingTestScheduler());
  const response: any = await handleAlexaDirectRequest(smartHome('Alexa.PowerController', 'TurnOn', 'spararama-hot-tub-bubbles'), commands);
  assert.equal(adapter.status.bubblesOn, true);
  assert.equal(response.context.properties[0].value, 'ON');
  assert.equal((await bubbles.getStatus()).bubblePhase, 'running');
});

test('Alexa thermostat command sets target temperature', async () => {
  const adapter = new AlexaTestAdapter();
  const commands = new AlexaSpaCommandService(adapter, undefined, new HeatingTestScheduler());
  await handleAlexaDirectRequest(smartHome('Alexa.ThermostatController', 'SetTargetTemperature', 'spararama-hot-tub', {
    targetSetpoint: { value: 39, scale: 'CELSIUS' }
  }), commands);
  assert.equal(adapter.status.targetTemperatureC, 39);
});

test('custom temperature intent reports live water temperature', async () => {
  const adapter = new AlexaTestAdapter();
  const commands = new AlexaSpaCommandService(adapter, undefined, new HeatingTestScheduler());
  const response: any = await handleAlexaDirectRequest(customIntent('TemperatureIntent'), commands);
  assert.equal(response.response.outputSpeech.text, 'The hot tub is 35 degrees.');
});

test('ready-at intent creates a normal heating schedule', async () => {
  const now = Date.parse('2026-09-05T14:00:00Z'); // 15:00 Europe/London
  const adapter = new AlexaTestAdapter();
  const scheduler = new HeatingTestScheduler();
  const commands = new AlexaSpaCommandService(adapter, undefined, scheduler, {
    timeZone: 'Europe/London',
    heatingRateCPerHour: 1.5,
    heatSoakMinutes: 0,
    defaultReadyTargetC: 38
  });
  const response: any = await handleAlexaDirectRequest(customIntent('ReadyAtIntent', { time: '17:00' }), commands, now);
  assert.equal(scheduler.schedules.length, 1);
  assert.equal(scheduler.schedules[0].targetTemperatureC, 38);
  assert.equal(scheduler.schedules[0].sessionData.source, 'alexa');
  assert.match(response.response.outputSpeech.text, /scheduled for 17:00/i);
});

test('Alexa times resolve in Europe/London rather than server UTC', () => {
  const now = Date.parse('2026-09-05T14:00:00Z'); // 15:00 BST
  assert.equal(resolveNextAlexaTime('17:00', 'Europe/London', now), Date.parse('2026-09-05T16:00:00Z'));
});
