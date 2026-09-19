import { timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  handleAlexaDirectRequest,
  resolveNextAlexaTime,
  type AlexaCommandServiceLike,
  type AlexaReadyPlan
} from '../../alexa/direct';
import type { BubbleAwareSpaStatus } from '../../spa/bubbles';
import type { SpaStatus } from '../../spa/types';
import type { RemoteCommandResult } from '../types';
import {
  CloudControlError,
  type CloudControlService,
  type StoredCloudCommand
} from './service';

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function secureEqual(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch(error => {
      const normalized = error instanceof CloudControlError
        ? error
        : new CloudControlError(500, 'alexa_integration_failed', error instanceof Error ? error.message : 'Alexa integration failed.');
      if (normalized.statusCode >= 500) console.error(error);
      res.status(normalized.statusCode).json({
        error: normalized.code,
        message: normalized.statusCode >= 500 ? 'Spararama Alexa integration failed.' : normalized.message
      });
    });
  };
}

function terminal(status: string) {
  return ['succeeded', 'failed', 'expired', 'rejected'].includes(status);
}

function commandResult(command: StoredCloudCommand) {
  const result = asRecord(command.result) as RemoteCommandResult | null;
  if (command.status !== 'succeeded') {
    const message = result?.error?.message || `Remote command ${command.status}.`;
    throw new Error(message);
  }
  return result?.result;
}

function isSpaStatus(value: unknown): value is SpaStatus {
  const record = asRecord(value);
  return Boolean(
    record
    && typeof record.connected === 'boolean'
    && typeof record.heaterOn === 'boolean'
    && typeof record.filterOn === 'boolean'
    && typeof record.bubblesOn === 'boolean'
    && typeof record.updatedAt === 'number'
  );
}

export class AlexaCloudCommandService implements AlexaCommandServiceLike {
  readonly timeZone: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly cloud: CloudControlService,
    private readonly installationId: string,
    private readonly integrationId = 'alexa',
    options: { timeZone?: string; timeoutMs?: number } = {}
  ) {
    this.timeZone = options.timeZone || process.env.SPARARAMA_TIME_ZONE || 'Europe/London';
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs || process.env.ALEXA_CLOUD_COMMAND_TIMEOUT_MS || 5_500));
  }

  async status(): Promise<BubbleAwareSpaStatus | SpaStatus> {
    const snapshot = await this.cloud.getInstallationStateForIntegration(this.installationId);
    if (snapshot.freshness.status !== 'fresh') {
      throw new Error(snapshot.freshness.status === 'stale'
        ? 'Home Spararama state is stale.'
        : 'Home Spararama is unreachable.');
    }

    const runtime = asRecord(snapshot.runtime);
    const state = asRecord(runtime?.state);
    const spa = state?.spa;
    if (!isSpaStatus(spa)) throw new Error('Home Spararama has not published a usable spa state.');
    return spa;
  }

  async setBubbles(on: boolean) {
    return this.runSpaCommand('setBubbles', { on });
  }

  async setFilter(on: boolean) {
    return this.runSpaCommand('setFilter', { on });
  }

  async setHeater(on: boolean) {
    return this.runSpaCommand('setHeater', { on });
  }

  async setTargetTemperature(celsius: number) {
    return this.runSpaCommand('setTargetTemperature', { celsius });
  }

  async planReadyAt(alexaTime: string, targetTemperatureC?: number, now = Date.now()): Promise<AlexaReadyPlan> {
    const targetTime = resolveNextAlexaTime(alexaTime, this.timeZone, now);
    const value = await this.runCommand('scheduleReadyAt', {
      targetTime,
      ...(Number.isFinite(targetTemperatureC) ? { targetTemperatureC: Number(targetTemperatureC) } : {})
    });
    const plan = asRecord(value);
    if (
      !plan
      || typeof plan.targetTime !== 'number'
      || typeof plan.startTime !== 'number'
      || typeof plan.targetTemperatureC !== 'number'
      || typeof plan.startTemperatureC !== 'number'
      || typeof plan.heatSoakMinutes !== 'number'
      || typeof plan.effectiveHeatingRateCPerHour !== 'number'
      || typeof plan.canMeetTarget !== 'boolean'
      || typeof plan.autoStartPreferred !== 'boolean'
      || typeof plan.weatherAdjusted !== 'boolean'
    ) {
      throw new Error('Home Spararama returned an invalid heating plan.');
    }
    return {
      targetTime: plan.targetTime,
      startTime: plan.startTime,
      targetTemperatureC: plan.targetTemperatureC,
      startTemperatureC: plan.startTemperatureC,
      heatSoakMinutes: plan.heatSoakMinutes,
      effectiveHeatingRateCPerHour: plan.effectiveHeatingRateCPerHour,
      canMeetTarget: plan.canMeetTarget,
      autoStartPreferred: plan.autoStartPreferred,
      weatherAdjusted: plan.weatherAdjusted
    };
  }

  private async runSpaCommand(type: 'setBubbles' | 'setFilter' | 'setHeater' | 'setTargetTemperature', payload: Record<string, unknown>) {
    const value = await this.runCommand(type, payload);
    if (!isSpaStatus(value)) throw new Error('Home Spararama returned an invalid spa status.');
    return value;
  }

  private async runCommand(type: string, payload: Record<string, unknown>) {
    const queued = await this.cloud.submitIntegrationCommand(
      this.installationId,
      this.integrationId,
      { type, payload }
    );
    const timeoutAt = Date.now() + this.timeoutMs;

    while (Date.now() <= timeoutAt) {
      const command = await this.cloud.getIntegrationCommand(this.installationId, queued.commandId);
      if (terminal(command.status)) return commandResult(command);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Home Spararama did not confirm the Alexa command in time.');
  }
}

export function registerCloudAlexaRoutes(
  app: Express,
  cloud: CloudControlService,
  options: {
    enabled?: boolean;
    installationId?: string;
    integrationSecret?: string;
    skillId?: string;
    timeZone?: string;
  } = {}
) {
  const enabled = options.enabled
    ?? String(process.env.ALEXA_CLOUD_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return;

  const installationId = String(options.installationId || process.env.ALEXA_CLOUD_INSTALLATION_ID || '').trim();
  const integrationSecret = String(options.integrationSecret || process.env.ALEXA_CLOUD_INTEGRATION_SECRET || '').trim();
  const skillId = String(options.skillId || process.env.ALEXA_SKILL_ID || '').trim();

  const commands = installationId
    ? new AlexaCloudCommandService(cloud, installationId, 'alexa', { timeZone: options.timeZone })
    : null;

  app.post('/api/integrations/alexa', asyncRoute(async (req, res) => {
    if (!installationId || !commands) {
      res.status(503).json({ error: 'Alexa cloud integration has no installation configured.' });
      return;
    }
    if (!integrationSecret) {
      res.status(503).json({ error: 'Alexa cloud integration has no credential configured.' });
      return;
    }

    const suppliedSecret = String(req.headers['x-spararama-alexa-integration-secret'] || '');
    if (!secureEqual(suppliedSecret, integrationSecret)) {
      res.status(401).json({ error: 'Invalid Alexa integration credential.' });
      return;
    }

    if (skillId) {
      const suppliedSkillId = String(req.headers['x-spararama-alexa-skill-id'] || '').trim();
      if (!secureEqual(suppliedSkillId, skillId)) {
        res.status(403).json({ error: 'Alexa skill ID does not match this Spararama integration.' });
        return;
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json(await handleAlexaDirectRequest(req.body, commands));
  }));
}
