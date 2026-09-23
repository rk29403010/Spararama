import type { BubbleSessionManager } from '../spa/bubbles';
import type { SpaAdapter, SpaStatus } from '../spa/types';
import type { RemoteCommandLedger } from './ledger';
import { MemoryRemoteCommandLedger } from './ledger';
import {
  REMOTE_COMMAND_VERSION,
  type CreateHeatingSchedulePayload,
  type RemoteCommandEnvelope,
  type RemoteCommandError,
  type RemoteCommandResult,
  type RemoteRequestedBy,
  type ScheduleReadyAtPayload
} from './types';

interface HeatingSchedulerLike {
  createSchedule(input: CreateHeatingSchedulePayload & { id?: string }): Promise<unknown>;
  cancelSchedule(scheduleId: string): Promise<unknown>;
}

interface HeatingReadyPlannerLike {
  scheduleReadyAt(
    input: ScheduleReadyAtPayload & { scheduleId?: string; sessionData?: Record<string, unknown> },
    now?: number
  ): Promise<unknown>;
}

interface ExecutorOptions {
  installationId: string;
  spa: SpaAdapter;
  bubbles?: BubbleSessionManager;
  heating?: HeatingSchedulerLike;
  readyPlanner?: HeatingReadyPlannerLike;
  ledger?: RemoteCommandLedger;
  now?: () => number;
  actuatorMinIntervalMs?: number;
  cadenceNow?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface ValidatedEnvelope {
  commandId: string;
  installationId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  requestedBy: RemoteRequestedBy;
}

class RemoteExecutionError extends Error {
  constructor(readonly code: RemoteCommandError['code'], message: string) {
    super(message);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function booleanField(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  if (typeof value !== 'boolean') {
    throw new RemoteExecutionError('invalid_command', `Expected boolean payload field: ${field}`);
  }
  return value;
}

function numberField(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  if (!finiteNumber(value)) {
    throw new RemoteExecutionError('invalid_command', `Expected numeric payload field: ${field}`);
  }
  return value;
}

function validateRequestedBy(value: unknown): RemoteRequestedBy | null {
  const record = asRecord(value);
  if (!record) return null;
  if (!['user', 'integration', 'system'].includes(String(record.kind || ''))) return null;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  return { kind: record.kind as RemoteRequestedBy['kind'], id: record.id };
}

function validateEnvelope(value: unknown): ValidatedEnvelope {
  const record = asRecord(value);
  if (!record) throw new RemoteExecutionError('invalid_command', 'Remote command must be an object.');
  if (record.version !== REMOTE_COMMAND_VERSION) {
    throw new RemoteExecutionError('invalid_command', `Unsupported remote command version: ${String(record.version)}`);
  }
  if (typeof record.commandId !== 'string' || !record.commandId.trim()) {
    throw new RemoteExecutionError('invalid_command', 'Remote command requires commandId.');
  }
  if (typeof record.installationId !== 'string' || !record.installationId.trim()) {
    throw new RemoteExecutionError('invalid_command', 'Remote command requires installationId.');
  }
  if (typeof record.type !== 'string' || !record.type.trim()) {
    throw new RemoteExecutionError('invalid_command', 'Remote command requires type.');
  }
  const payload = asRecord(record.payload);
  if (!payload) throw new RemoteExecutionError('invalid_command', 'Remote command payload must be an object.');
  const createdAt = record.createdAt;
  const expiresAt = record.expiresAt;
  if (!finiteNumber(createdAt) || !finiteNumber(expiresAt) || expiresAt < createdAt) {
    throw new RemoteExecutionError('invalid_command', 'Remote command requires valid createdAt/expiresAt timestamps.');
  }
  const requestedBy = validateRequestedBy(record.requestedBy);
  if (!requestedBy) throw new RemoteExecutionError('invalid_command', 'Remote command requires valid requestedBy metadata.');

  return {
    commandId: record.commandId,
    installationId: record.installationId,
    type: record.type,
    payload,
    createdAt,
    expiresAt,
    requestedBy
  };
}

export class RemoteCommandExecutor {
  private readonly ledger: RemoteCommandLedger;
  private readonly now: () => number;
  private readonly actuatorMinIntervalMs: number;
  private readonly cadenceNow: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly inFlight = new Map<string, Promise<RemoteCommandResult>>();
  private actuatorTail: Promise<void> = Promise.resolve();
  private lastActuatorStartedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: ExecutorOptions) {
    this.ledger = options.ledger || new MemoryRemoteCommandLedger();
    this.now = options.now || (() => Date.now());
    this.actuatorMinIntervalMs = Math.max(0, Number(options.actuatorMinIntervalMs || 0));
    this.cadenceNow = options.cadenceNow || (() => Date.now());
    this.sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  }

  async execute(command: RemoteCommandEnvelope | unknown): Promise<RemoteCommandResult> {
    let envelope: ValidatedEnvelope;
    try {
      envelope = validateEnvelope(command);
    } catch (error) {
      const now = this.now();
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof RemoteExecutionError ? error.code : 'invalid_command';
      const raw = asRecord(command);
      return {
        version: REMOTE_COMMAND_VERSION,
        commandId: typeof raw?.commandId === 'string' ? raw.commandId : 'invalid',
        installationId: typeof raw?.installationId === 'string' ? raw.installationId : this.options.installationId,
        type: typeof raw?.type === 'string' ? raw.type : 'invalid',
        status: 'rejected',
        acceptedAt: now,
        completedAt: now,
        error: { code, message }
      };
    }

    if (envelope.installationId !== this.options.installationId) {
      const now = this.now();
      return this.result(envelope, 'rejected', now, undefined, {
        code: 'wrong_installation',
        message: `Command belongs to installation ${envelope.installationId}, not ${this.options.installationId}.`
      });
    }

    const recorded = await this.ledger.get(envelope.commandId);
    if (recorded) return recorded;

    const existing = this.inFlight.get(envelope.commandId);
    if (existing) return existing;

    const operation = this.executeNew(envelope);
    this.inFlight.set(envelope.commandId, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(envelope.commandId);
    }
  }

  private async executeNew(command: ValidatedEnvelope): Promise<RemoteCommandResult> {
    const acceptedAt = this.now();
    let result: RemoteCommandResult;

    if (acceptedAt > command.expiresAt) {
      result = this.result(command, 'expired', acceptedAt, undefined, {
        code: 'expired',
        message: 'Remote command expired before the local node could execute it.'
      });
      await this.ledger.record(result);
      return result;
    }

    try {
      const value = await this.executeAllowed(command);
      result = this.result(command, 'succeeded', acceptedAt, value);
    } catch (error) {
      const executionError = error instanceof RemoteExecutionError
        ? error
        : new RemoteExecutionError('execution_failed', error instanceof Error ? error.message : String(error));
      const status = executionError.code === 'expired'
        ? 'expired'
        : executionError.code === 'invalid_command' || executionError.code === 'unsupported_command'
          ? 'rejected'
          : 'failed';
      result = this.result(
        command,
        status,
        acceptedAt,
        undefined,
        { code: executionError.code, message: executionError.message }
      );
    }

    await this.ledger.record(result);
    return result;
  }

  private async executeAllowed(command: ValidatedEnvelope): Promise<unknown> {
    switch (command.type) {
      case 'readStatus':
        return this.status();

      case 'setTargetTemperature': {
        const celsius = numberField(command.payload, 'celsius');
        return this.withActuatorCadence(command, async () => {
          const before = await this.requireRemoteSpa();
          if (before.targetTemperatureC === celsius) return before;
          await this.waitForActuatorSlot(command);
          return this.options.spa.setTargetTemperature(celsius);
        });
      }

      case 'setHeater': {
        const on = booleanField(command.payload, 'on');
        return this.withActuatorCadence(command, async () => {
          const before = await this.requireRemoteSpa();
          if (before.heaterOn === on) return before;
          await this.waitForActuatorSlot(command);
          return this.options.spa.setHeater(on);
        });
      }

      case 'setFilter': {
        const on = booleanField(command.payload, 'on');
        return this.withActuatorCadence(command, async () => {
          const before = await this.requireRemoteSpa();
          if (before.filterOn === on) return before;
          await this.waitForActuatorSlot(command);
          return this.options.spa.setFilter(on);
        });
      }

      case 'setBubbles': {
        const on = booleanField(command.payload, 'on');
        const autoRestart = command.payload.autoRestart;
        if (autoRestart !== undefined && typeof autoRestart !== 'boolean') {
          throw new RemoteExecutionError('invalid_command', 'autoRestart must be boolean when supplied.');
        }
        return this.withActuatorCadence(command, async () => {
          const before = await this.requireRemoteSpa();
          if (before.bubblesOn === on) return before;
          await this.waitForActuatorSlot(command);
          return this.options.bubbles
            ? this.options.bubbles.setBubbles(on, { autoRestart: autoRestart === true })
            : this.options.spa.setBubbles(on);
        });
      }

      case 'scheduleReadyAt': {
        if (!this.options.readyPlanner) {
          throw new RemoteExecutionError('scheduler_unavailable', 'Ready-at heating planner is not configured.');
        }
        const payload = this.validateReadyAt(command.payload);
        return this.options.readyPlanner.scheduleReadyAt({
          ...payload,
          scheduleId: `remote-${command.commandId}`,
          sessionData: {
            source: 'remote',
            requestedBy: command.requestedBy
          }
        }, this.now());
      }

      case 'cancelHeatingSchedule': {
        if (!this.options.heating) {
          throw new RemoteExecutionError('scheduler_unavailable', 'Heating scheduler is not configured.');
        }
        const scheduleId = command.payload.scheduleId;
        if (typeof scheduleId !== 'string' || !scheduleId.trim()) {
          throw new RemoteExecutionError('invalid_command', 'scheduleId must be a non-empty string.');
        }
        return this.options.heating.cancelSchedule(scheduleId);
      }

      case 'createHeatingSchedule': {
        if (!this.options.heating) {
          throw new RemoteExecutionError('scheduler_unavailable', 'Heating scheduler is not configured.');
        }
        const payload = this.validateHeatingSchedule(command.payload);
        return this.options.heating.createSchedule({
          ...payload,
          id: payload.id || `remote-${command.commandId}`,
          sessionData: {
            ...(payload.sessionData || {}),
            source: 'remote',
            requestedBy: command.requestedBy
          }
        });
      }

      default:
        throw new RemoteExecutionError('unsupported_command', `Unsupported remote command type: ${command.type}`);
    }
  }

  private async withActuatorCadence<T>(command: ValidatedEnvelope, operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.actuatorTail;
    this.actuatorTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      if (this.now() > command.expiresAt) {
        throw new RemoteExecutionError('expired', 'Remote command expired while waiting for an actuator slot.');
      }
      return await operation();
    } finally {
      release();
    }
  }

  private async waitForActuatorSlot(command: ValidatedEnvelope) {
    const remaining = this.lastActuatorStartedAt + this.actuatorMinIntervalMs - this.cadenceNow();
    if (remaining > 0) await this.sleep(remaining);
    if (this.now() > command.expiresAt) {
      throw new RemoteExecutionError('expired', 'Remote command expired while waiting for safe actuator cadence.');
    }
    this.lastActuatorStartedAt = this.cadenceNow();
  }

  private async status() {
    return this.options.bubbles ? this.options.bubbles.getStatus() : this.options.spa.getStatus();
  }

  private async requireRemoteSpa() {
    const status = await this.status();
    if (!status.connected || status.transport === 'manual') {
      throw new RemoteExecutionError('spa_unavailable', 'Spa is not remotely connected.');
    }
    return status;
  }

  private validateReadyAt(payload: Record<string, unknown>): ScheduleReadyAtPayload {
    const targetTime = numberField(payload, 'targetTime');
    if (targetTime <= this.now()) {
      throw new RemoteExecutionError('invalid_command', 'Heating target time must be in the future.');
    }

    const targetTemperatureC = payload.targetTemperatureC === undefined
      ? undefined
      : numberField(payload, 'targetTemperatureC');
    const heatSoakMinutes = payload.heatSoakMinutes === undefined
      ? undefined
      : numberField(payload, 'heatSoakMinutes');
    if (heatSoakMinutes !== undefined && heatSoakMinutes < 0) {
      throw new RemoteExecutionError('invalid_command', 'heatSoakMinutes must not be negative.');
    }

    const alertOnTargetReached = payload.alertOnTargetReached;
    const alertOnHeatSoakComplete = payload.alertOnHeatSoakComplete;
    if (alertOnTargetReached !== undefined && typeof alertOnTargetReached !== 'boolean') {
      throw new RemoteExecutionError('invalid_command', 'alertOnTargetReached must be boolean when supplied.');
    }
    if (alertOnHeatSoakComplete !== undefined && typeof alertOnHeatSoakComplete !== 'boolean') {
      throw new RemoteExecutionError('invalid_command', 'alertOnHeatSoakComplete must be boolean when supplied.');
    }

    return {
      targetTime,
      ...(targetTemperatureC !== undefined ? { targetTemperatureC } : {}),
      ...(heatSoakMinutes !== undefined ? { heatSoakMinutes } : {}),
      ...(typeof alertOnTargetReached === 'boolean' ? { alertOnTargetReached } : {}),
      ...(typeof alertOnHeatSoakComplete === 'boolean' ? { alertOnHeatSoakComplete } : {})
    };
  }

  private validateHeatingSchedule(payload: Record<string, unknown>): CreateHeatingSchedulePayload {
    const startTime = numberField(payload, 'startTime');
    const targetTime = numberField(payload, 'targetTime');
    const startTemperatureC = numberField(payload, 'startTemperatureC');
    const targetTemperatureC = numberField(payload, 'targetTemperatureC');
    const autoStartPreferred = booleanField(payload, 'autoStartPreferred');

    const heatSoakMinutes = payload.heatSoakMinutes === undefined
      ? undefined
      : numberField(payload, 'heatSoakMinutes');
    const alertOnTargetReached = payload.alertOnTargetReached;
    const alertOnHeatSoakComplete = payload.alertOnHeatSoakComplete;
    if (alertOnTargetReached !== undefined && typeof alertOnTargetReached !== 'boolean') {
      throw new RemoteExecutionError('invalid_command', 'alertOnTargetReached must be boolean when supplied.');
    }
    if (alertOnHeatSoakComplete !== undefined && typeof alertOnHeatSoakComplete !== 'boolean') {
      throw new RemoteExecutionError('invalid_command', 'alertOnHeatSoakComplete must be boolean when supplied.');
    }
    const id = payload.id;
    if (id !== undefined && typeof id !== 'string') {
      throw new RemoteExecutionError('invalid_command', 'Heating schedule id must be a string when supplied.');
    }
    const sessionData = payload.sessionData;
    if (sessionData !== undefined && !asRecord(sessionData)) {
      throw new RemoteExecutionError('invalid_command', 'sessionData must be an object when supplied.');
    }

    return {
      ...(typeof id === 'string' && id ? { id } : {}),
      startTime,
      targetTime,
      startTemperatureC,
      targetTemperatureC,
      autoStartPreferred,
      ...(heatSoakMinutes !== undefined ? { heatSoakMinutes } : {}),
      ...(typeof alertOnTargetReached === 'boolean' ? { alertOnTargetReached } : {}),
      ...(typeof alertOnHeatSoakComplete === 'boolean' ? { alertOnHeatSoakComplete } : {}),
      ...(sessionData ? { sessionData: sessionData as Record<string, unknown> } : {})
    };
  }

  private result(
    command: ValidatedEnvelope,
    status: RemoteCommandResult['status'],
    acceptedAt: number,
    value?: unknown,
    error?: RemoteCommandError
  ): RemoteCommandResult {
    return {
      version: REMOTE_COMMAND_VERSION,
      commandId: command.commandId,
      installationId: command.installationId,
      type: command.type,
      status,
      acceptedAt,
      completedAt: this.now(),
      requestedBy: command.requestedBy,
      ...(value !== undefined ? { result: value } : {}),
      ...(error ? { error } : {})
    };
  }
}
