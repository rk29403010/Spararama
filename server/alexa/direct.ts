import type { BubbleAwareSpaStatus, BubbleSessionManager } from '../spa/bubbles';
import type { SpaAdapter, SpaStatus } from '../spa/types';

export const ALEXA_ENDPOINTS = {
  hotTub: 'spararama-hot-tub',
  bubbles: 'spararama-hot-tub-bubbles',
  filter: 'spararama-hot-tub-filter'
} as const;

interface HeatingSchedulerLike {
  createSchedule(input: {
    id?: string;
    startTime: number;
    targetTime: number;
    startTemperatureC: number;
    targetTemperatureC: number;
    autoStartPreferred: boolean;
    heatSoakMinutes?: number;
    alertOnTargetReached?: boolean;
    alertOnHeatSoakComplete?: boolean;
    sessionData?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface AlexaDirectOptions {
  timeZone?: string;
  heatingRateCPerHour?: number;
  heatSoakMinutes?: number;
  defaultReadyTargetC?: number;
}

export interface AlexaReadyPlan {
  targetTime: number;
  startTime: number;
  targetTemperatureC: number;
  startTemperatureC: number;
  heatSoakMinutes: number;
  canMeetTarget: boolean;
  autoStartPreferred: boolean;
}

function finitePositive(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNonNegative(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function environmentNumber(name: string) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localDateParts(timestamp: number, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute
  };
}

function zonedDateTimeToEpoch(parts: LocalDateParts, timeZone: string) {
  const wantedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  let guess = wantedAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localDateParts(guess, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const adjustment = wantedAsUtc - actualAsUtc;
    guess += adjustment;
    if (adjustment === 0) break;
  }
  return guess;
}

export function resolveNextAlexaTime(value: string, timeZone = 'Europe/London', now = Date.now()) {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) throw new Error('Please give an exact time, for example five p m.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('That time is not valid.');

  const today = localDateParts(now, timeZone);
  const daySeed = new Date(Date.UTC(today.year, today.month - 1, today.day));
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const candidateDay = new Date(daySeed.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const candidate = zonedDateTimeToEpoch({
      year: candidateDay.getUTCFullYear(),
      month: candidateDay.getUTCMonth() + 1,
      day: candidateDay.getUTCDate(),
      hour,
      minute
    }, timeZone);
    if (candidate > now) return candidate;
  }
  throw new Error('Could not resolve the requested time.');
}

function temperatureToC(value: unknown, scale: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Alexa did not provide a valid temperature.');
  const normalizedScale = String(scale || 'CELSIUS').toUpperCase();
  if (normalizedScale === 'FAHRENHEIT') return (number - 32) * 5 / 9;
  if (normalizedScale === 'KELVIN') return number - 273.15;
  return number;
}

function speechTemperature(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function property(namespace: string, name: string, value: unknown, status: SpaStatus, uncertaintyInMilliseconds = 500) {
  return {
    namespace,
    name,
    value,
    timeOfSample: new Date(status.updatedAt || Date.now()).toISOString(),
    uncertaintyInMilliseconds
  };
}

function endpointHealth(status: SpaStatus) {
  return property('Alexa.EndpointHealth', 'connectivity', {
    value: status.connected ? 'OK' : 'UNREACHABLE'
  }, status, 0);
}

function hotTubProperties(status: SpaStatus) {
  return [
    property('Alexa.TemperatureSensor', 'temperature', {
      value: status.waterTemperatureC,
      scale: 'CELSIUS'
    }, status),
    property('Alexa.ThermostatController', 'targetSetpoint', {
      value: status.targetTemperatureC,
      scale: 'CELSIUS'
    }, status),
    endpointHealth(status)
  ];
}

function powerProperties(status: SpaStatus, endpointId: string) {
  const on = endpointId === ALEXA_ENDPOINTS.bubbles ? status.bubblesOn : status.filterOn;
  return [
    property('Alexa.PowerController', 'powerState', on ? 'ON' : 'OFF', status),
    endpointHealth(status)
  ];
}

function responseHeader(directive: any, name = 'Response') {
  return {
    namespace: 'Alexa',
    name,
    messageId: crypto.randomUUID(),
    ...(directive?.header?.correlationToken ? { correlationToken: directive.header.correlationToken } : {}),
    payloadVersion: '3'
  };
}

function responseEndpoint(directive: any) {
  return {
    endpointId: directive?.endpoint?.endpointId,
    ...(directive?.endpoint?.scope ? { scope: directive.endpoint.scope } : {})
  };
}

function smartHomeResponse(directive: any, properties: unknown[]) {
  return {
    context: { properties },
    event: {
      header: responseHeader(directive),
      endpoint: responseEndpoint(directive),
      payload: {}
    }
  };
}

function smartHomeError(directive: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Alexa command failed.');
  const lower = message.toLowerCase();
  const type = lower.includes('cooling down') || lower.includes('busy')
    ? 'ENDPOINT_BUSY'
    : lower.includes('not remotely connected') || lower.includes('unreachable') || lower.includes('not connected')
      ? 'ENDPOINT_UNREACHABLE'
      : lower.includes('temperature') || lower.includes('valid')
        ? 'INVALID_VALUE'
        : 'INTERNAL_ERROR';
  return {
    event: {
      header: responseHeader(directive, 'ErrorResponse'),
      endpoint: responseEndpoint(directive),
      payload: { type, message }
    }
  };
}

function capability(interfaceName: string, version: string, supported: string[]) {
  return {
    type: 'AlexaInterface',
    interface: interfaceName,
    version,
    properties: {
      supported: supported.map(name => ({ name })),
      proactivelyReported: false,
      retrievable: true
    }
  };
}

function discoveryResponse() {
  const endpointHealthCapability = capability('Alexa.EndpointHealth', '3.2', ['connectivity']);
  const baseCapability = { type: 'AlexaInterface', interface: 'Alexa', version: '3' };
  return {
    event: {
      header: {
        namespace: 'Alexa.Discovery',
        name: 'Discover.Response',
        payloadVersion: '3',
        messageId: crypto.randomUUID()
      },
      payload: {
        endpoints: [
          {
            endpointId: ALEXA_ENDPOINTS.hotTub,
            manufacturerName: 'Spararama',
            friendlyName: 'Hot Tub',
            description: 'Spararama hot tub temperature control',
            displayCategories: ['THERMOSTAT'],
            cookie: {},
            capabilities: [
              capability('Alexa.TemperatureSensor', '3', ['temperature']),
              {
                ...capability('Alexa.ThermostatController', '3.2', ['targetSetpoint']),
                configuration: { supportsScheduling: false }
              },
              endpointHealthCapability,
              baseCapability
            ]
          },
          {
            endpointId: ALEXA_ENDPOINTS.bubbles,
            manufacturerName: 'Spararama',
            friendlyName: 'Hot Tub Bubbles',
            description: 'Spararama hot tub bubbles',
            displayCategories: ['SWITCH'],
            cookie: {},
            capabilities: [
              capability('Alexa.PowerController', '3', ['powerState']),
              endpointHealthCapability,
              baseCapability
            ]
          },
          {
            endpointId: ALEXA_ENDPOINTS.filter,
            manufacturerName: 'Spararama',
            friendlyName: 'Hot Tub Filter',
            description: 'Spararama hot tub filter',
            displayCategories: ['SWITCH'],
            cookie: {},
            capabilities: [
              capability('Alexa.PowerController', '3', ['powerState']),
              endpointHealthCapability,
              baseCapability
            ]
          }
        ]
      }
    }
  };
}

function customSpeech(text: string, shouldEndSession = true) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      shouldEndSession
    }
  };
}

function customSlot(event: any, name: string) {
  return event?.request?.intent?.slots?.[name]?.value;
}

function formatTime(timestamp: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

export class AlexaSpaCommandService {
  readonly timeZone: string;
  readonly heatingRateCPerHour: number;
  readonly heatSoakMinutes: number;
  readonly defaultReadyTargetC?: number;

  constructor(
    private readonly adapter: SpaAdapter,
    private readonly bubbles: BubbleSessionManager | undefined,
    private readonly heating: HeatingSchedulerLike,
    options: AlexaDirectOptions = {}
  ) {
    this.timeZone = options.timeZone || process.env.SPARARAMA_TIME_ZONE || 'Europe/London';
    this.heatingRateCPerHour = finitePositive(
      options.heatingRateCPerHour ?? environmentNumber('ALEXA_HEATING_RATE_C_PER_HOUR'),
      1.5
    );
    this.heatSoakMinutes = finiteNonNegative(
      options.heatSoakMinutes ?? environmentNumber('ALEXA_HEAT_SOAK_MINUTES'),
      0
    );
    const configuredTarget = options.defaultReadyTargetC ?? environmentNumber('ALEXA_DEFAULT_READY_TARGET_C');
    this.defaultReadyTargetC = Number.isFinite(configuredTarget) ? configuredTarget : undefined;
  }

  status(): Promise<BubbleAwareSpaStatus | SpaStatus> {
    return this.bubbles ? this.bubbles.getStatus() : this.adapter.getStatus();
  }

  async setBubbles(on: boolean) {
    return this.bubbles ? this.bubbles.setBubbles(on) : this.adapter.setBubbles(on);
  }

  setFilter(on: boolean) {
    return this.adapter.setFilter(on);
  }

  setHeater(on: boolean) {
    return this.adapter.setHeater(on);
  }

  setTargetTemperature(celsius: number) {
    return this.adapter.setTargetTemperature(celsius);
  }

  async planReadyAt(alexaTime: string, targetTemperatureC?: number, now = Date.now()): Promise<AlexaReadyPlan> {
    const status = await this.status();
    const targetTime = resolveNextAlexaTime(alexaTime, this.timeZone, now);
    const target = Number.isFinite(targetTemperatureC)
      ? Number(targetTemperatureC)
      : this.defaultReadyTargetC ?? status.targetTemperatureC;
    if (!Number.isFinite(status.waterTemperatureC) || !Number.isFinite(target)) {
      throw new Error('A current and target temperature are required to plan heating.');
    }

    const hoursToHeat = Math.max(0, target - status.waterTemperatureC) / this.heatingRateCPerHour;
    const totalMs = (hoursToHeat + this.heatSoakMinutes / 60) * 60 * 60 * 1000;
    const calculatedStartTime = targetTime - totalMs;
    const startTime = Math.max(now, calculatedStartTime);
    const autoStartPreferred = status.connected && status.transport !== 'manual';

    await this.heating.createSchedule({
      startTime,
      targetTime,
      startTemperatureC: status.waterTemperatureC,
      targetTemperatureC: target,
      autoStartPreferred,
      heatSoakMinutes: this.heatSoakMinutes,
      alertOnTargetReached: true,
      alertOnHeatSoakComplete: true,
      sessionData: {
        source: 'alexa',
        estimation: 'base-heating-rate',
        heatingRateCPerHour: this.heatingRateCPerHour
      }
    });

    return {
      targetTime,
      startTime,
      targetTemperatureC: target,
      startTemperatureC: status.waterTemperatureC,
      heatSoakMinutes: this.heatSoakMinutes,
      canMeetTarget: calculatedStartTime >= now,
      autoStartPreferred
    };
  }
}

async function handleSmartHome(event: any, commands: AlexaSpaCommandService) {
  const directive = event?.directive;
  const namespace = directive?.header?.namespace;
  const name = directive?.header?.name;

  if (namespace === 'Alexa.Discovery' && name === 'Discover') return discoveryResponse();

  const endpointId = directive?.endpoint?.endpointId;
  if (!Object.values(ALEXA_ENDPOINTS).includes(endpointId)) {
    return smartHomeError(directive, new Error('No such Spararama endpoint.'));
  }

  try {
    if (namespace === 'Alexa' && name === 'ReportState') {
      const status = await commands.status();
      return smartHomeResponse(
        directive,
        endpointId === ALEXA_ENDPOINTS.hotTub ? hotTubProperties(status) : powerProperties(status, endpointId)
      );
    }

    if (namespace === 'Alexa.PowerController' && ['TurnOn', 'TurnOff'].includes(name)) {
      const on = name === 'TurnOn';
      const status = endpointId === ALEXA_ENDPOINTS.bubbles
        ? await commands.setBubbles(on)
        : endpointId === ALEXA_ENDPOINTS.filter
          ? await commands.setFilter(on)
          : (() => { throw new Error('Power control is not supported for that endpoint.'); })();
      return smartHomeResponse(directive, powerProperties(status, endpointId));
    }

    if (namespace === 'Alexa.ThermostatController' && endpointId === ALEXA_ENDPOINTS.hotTub) {
      if (name === 'SetTargetTemperature') {
        const setpoint = directive?.payload?.targetSetpoint;
        const status = await commands.setTargetTemperature(temperatureToC(setpoint?.value, setpoint?.scale));
        return smartHomeResponse(directive, hotTubProperties(status));
      }
      if (name === 'AdjustTargetTemperature') {
        const delta = directive?.payload?.targetSetpointDelta;
        const before = await commands.status();
        const status = await commands.setTargetTemperature(
          before.targetTemperatureC + temperatureToC(delta?.value, delta?.scale)
        );
        return smartHomeResponse(directive, hotTubProperties(status));
      }
    }

    throw new Error(`Unsupported Alexa directive: ${namespace}.${name}`);
  } catch (error) {
    return smartHomeError(directive, error);
  }
}

async function handleCustom(event: any, commands: AlexaSpaCommandService, now = Date.now()) {
  const type = event?.request?.type;
  if (type === 'LaunchRequest') {
    return customSpeech('Spararama is connected. You can ask for the hot tub temperature, control the bubbles, or ask me to have the hot tub ready for a time.', false);
  }
  if (type === 'SessionEndedRequest') return { version: '1.0', response: {} };
  if (type !== 'IntentRequest') return customSpeech('I did not understand that Spararama request.');

  const intent = event?.request?.intent?.name;
  try {
    if (intent === 'TemperatureIntent') {
      const status = await commands.status();
      const prefix = status.connected ? 'The hot tub is' : 'The last known hot tub temperature is';
      return customSpeech(`${prefix} ${speechTemperature(status.waterTemperatureC)} degrees.`);
    }
    if (intent === 'BubblesOnIntent') {
      await commands.setBubbles(true);
      return customSpeech('Hot tub bubbles are on.');
    }
    if (intent === 'BubblesOffIntent') {
      await commands.setBubbles(false);
      return customSpeech('Hot tub bubbles are off.');
    }
    if (intent === 'FilterOnIntent') {
      await commands.setFilter(true);
      return customSpeech('Hot tub filter is on.');
    }
    if (intent === 'FilterOffIntent') {
      await commands.setFilter(false);
      return customSpeech('Hot tub filter is off.');
    }
    if (intent === 'HeaterOnIntent') {
      await commands.setHeater(true);
      return customSpeech('Hot tub heater is on.');
    }
    if (intent === 'HeaterOffIntent') {
      await commands.setHeater(false);
      return customSpeech('Hot tub heater is off.');
    }
    if (intent === 'ReadyAtIntent') {
      const time = customSlot(event, 'time');
      if (!time) return customSpeech('What time should I have the hot tub ready?', false);
      const suppliedTarget = Number(customSlot(event, 'temperature'));
      const plan = await commands.planReadyAt(time, Number.isFinite(suppliedTarget) ? suppliedTarget : undefined, now);
      const readyText = formatTime(plan.targetTime, commands.timeZone);
      const startText = formatTime(plan.startTime, commands.timeZone);
      if (!plan.autoStartPreferred) {
        return customSpeech(`I have scheduled the hot tub for ${readyText}, but remote control is not currently available, so Spararama will ask for a manual start.`);
      }
      if (!plan.canMeetTarget) {
        return customSpeech(`I will start heating now, but based on the current temperature it may not reach ${speechTemperature(plan.targetTemperatureC)} degrees by ${readyText}.`);
      }
      return customSpeech(`Okay. The hot tub is scheduled for ${readyText}. Heating should start at about ${startText}.`);
    }
    if (intent === 'AMAZON.HelpIntent') {
      return customSpeech('You can ask Spararama for the hot tub temperature, say bubbles on or off, or ask me to have the hot tub ready for a time.', false);
    }
    if (intent === 'AMAZON.CancelIntent' || intent === 'AMAZON.StopIntent') return customSpeech('Okay.');
    if (intent === 'AMAZON.FallbackIntent') return customSpeech('I did not understand that Spararama request.');
    return customSpeech('That Spararama command is not supported yet.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'That command failed.';
    return customSpeech(message);
  }
}

export async function handleAlexaDirectRequest(event: any, commands: AlexaSpaCommandService, now = Date.now()) {
  if (event?.directive?.header) return handleSmartHome(event, commands);
  if (event?.request?.type) return handleCustom(event, commands, now);
  throw new Error('Unsupported Alexa request payload.');
}
