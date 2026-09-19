import {
  REMOTE_COMMAND_TYPES,
  REMOTE_COMMAND_VERSION,
  type CreateHeatingSchedulePayload,
  type RemoteCommandEnvelope,
  type RemoteCommandType
} from '../types';

export type InstallationRole = 'owner' | 'member' | 'viewer';

export interface CloudPrincipal {
  uid: string;
  email?: string;
}

export interface InstallationMembership {
  installationId: string;
  role: InstallationRole;
  name?: string;
}

export interface InstallationRuntimeDocument {
  heartbeatAtMs?: number;
  statePublishedAtMs?: number;
  presence?: unknown;
  state?: unknown;
}

export interface StoredCloudCommand {
  commandId: string;
  installationId: string;
  type: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  requestedBy?: unknown;
  payload?: unknown;
  result?: unknown;
}

export interface CloudControlStore {
  listMemberships(uid: string): Promise<InstallationMembership[]>;
  getMembership(installationId: string, uid: string): Promise<InstallationMembership | null>;
  getRuntime(installationId: string): Promise<InstallationRuntimeDocument | null>;
  createCommand(command: RemoteCommandEnvelope): Promise<void>;
  getCommand(installationId: string, commandId: string): Promise<StoredCloudCommand | null>;
}

export class CloudControlError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface CommandRateLimiter {
  consume(key: string, now: number): boolean;
}

export class FixedWindowCommandRateLimiter implements CommandRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit = Math.max(1, Number(process.env.REMOTE_CLOUD_COMMANDS_PER_MINUTE || 30)),
    private readonly windowMs = 60_000
  ) {}

  consume(key: string, now: number) {
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CloudControlError(400, 'invalid_command', 'Command payload must be an object.');
  }
  return value as Record<string, unknown>;
}

function requiredNumber(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CloudControlError(400, 'invalid_command', `Expected numeric payload field: ${field}`);
  }
  return value;
}

function requiredBoolean(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  if (typeof value !== 'boolean') {
    throw new CloudControlError(400, 'invalid_command', `Expected boolean payload field: ${field}`);
  }
  return value;
}

function optionalBoolean(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new CloudControlError(400, 'invalid_command', `${field} must be boolean when supplied.`);
  }
  return value;
}

function readyAtPayload(payload: Record<string, unknown>, now: number) {
  const targetTime = requiredNumber(payload, 'targetTime');
  if (targetTime <= now) {
    throw new CloudControlError(400, 'invalid_command', 'Heating target time must be in the future.');
  }
  const targetTemperatureC = payload.targetTemperatureC === undefined
    ? undefined
    : requiredNumber(payload, 'targetTemperatureC');
  const heatSoakMinutes = payload.heatSoakMinutes === undefined
    ? undefined
    : requiredNumber(payload, 'heatSoakMinutes');
  if (heatSoakMinutes !== undefined && heatSoakMinutes < 0) {
    throw new CloudControlError(400, 'invalid_command', 'heatSoakMinutes must not be negative.');
  }
  const alertOnTargetReached = optionalBoolean(payload, 'alertOnTargetReached');
  const alertOnHeatSoakComplete = optionalBoolean(payload, 'alertOnHeatSoakComplete');

  return {
    targetTime,
    ...(targetTemperatureC !== undefined ? { targetTemperatureC } : {}),
    ...(heatSoakMinutes !== undefined ? { heatSoakMinutes } : {}),
    ...(alertOnTargetReached !== undefined ? { alertOnTargetReached } : {}),
    ...(alertOnHeatSoakComplete !== undefined ? { alertOnHeatSoakComplete } : {})
  };
}

function heatingPayload(payload: Record<string, unknown>, now: number): CreateHeatingSchedulePayload {
  const startTime = requiredNumber(payload, 'startTime');
  const targetTime = requiredNumber(payload, 'targetTime');
  const startTemperatureC = requiredNumber(payload, 'startTemperatureC');
  const targetTemperatureC = requiredNumber(payload, 'targetTemperatureC');
  const autoStartPreferred = requiredBoolean(payload, 'autoStartPreferred');
  if (targetTime <= now) {
    throw new CloudControlError(400, 'invalid_command', 'Heating target time must be in the future.');
  }
  if (startTime > targetTime) {
    throw new CloudControlError(400, 'invalid_command', 'Heating start time must not be after the target time.');
  }

  const heatSoakMinutes = payload.heatSoakMinutes === undefined
    ? undefined
    : requiredNumber(payload, 'heatSoakMinutes');
  if (heatSoakMinutes !== undefined && heatSoakMinutes < 0) {
    throw new CloudControlError(400, 'invalid_command', 'heatSoakMinutes must not be negative.');
  }

  const alertOnTargetReached = optionalBoolean(payload, 'alertOnTargetReached');
  const alertOnHeatSoakComplete = optionalBoolean(payload, 'alertOnHeatSoakComplete');
  const sessionData = payload.sessionData;
  if (sessionData !== undefined && (!sessionData || typeof sessionData !== 'object' || Array.isArray(sessionData))) {
    throw new CloudControlError(400, 'invalid_command', 'sessionData must be an object when supplied.');
  }

  return {
    startTime,
    targetTime,
    startTemperatureC,
    targetTemperatureC,
    autoStartPreferred,
    ...(heatSoakMinutes !== undefined ? { heatSoakMinutes } : {}),
    ...(alertOnTargetReached !== undefined ? { alertOnTargetReached } : {}),
    ...(alertOnHeatSoakComplete !== undefined ? { alertOnHeatSoakComplete } : {}),
    ...(sessionData !== undefined ? { sessionData: sessionData as Record<string, unknown> } : {})
  };
}

export function validateCloudCommandRequest(type: unknown, rawPayload: unknown, now: number): {
  type: RemoteCommandType;
  payload: Record<string, unknown>;
} {
  if (typeof type !== 'string' || !REMOTE_COMMAND_TYPES.includes(type as RemoteCommandType)) {
    throw new CloudControlError(400, 'unsupported_command', 'Unsupported remote command type.');
  }

  const payload = rawPayload === undefined ? {} : asRecord(rawPayload);
  const commandType = type as RemoteCommandType;

  switch (commandType) {
    case 'readStatus':
      return { type: commandType, payload: {} };
    case 'setTargetTemperature':
      return { type: commandType, payload: { celsius: requiredNumber(payload, 'celsius') } };
    case 'setHeater':
    case 'setFilter':
      return { type: commandType, payload: { on: requiredBoolean(payload, 'on') } };
    case 'setBubbles': {
      const autoRestart = optionalBoolean(payload, 'autoRestart');
      return {
        type: commandType,
        payload: {
          on: requiredBoolean(payload, 'on'),
          ...(autoRestart !== undefined ? { autoRestart } : {})
        }
      };
    }
    case 'scheduleReadyAt':
      return { type: commandType, payload: readyAtPayload(payload, now) };
    case 'createHeatingSchedule':
      return { type: commandType, payload: heatingPayload(payload, now) as unknown as Record<string, unknown> };
  }
}

export function defaultCommandTtlMs(type: RemoteCommandType) {
  if (type === 'readStatus') return 15_000;
  if (type === 'createHeatingSchedule' || type === 'scheduleReadyAt') return 60_000;
  return 30_000;
}

export function runtimeFreshness(runtime: InstallationRuntimeDocument | null, now: number) {
  if (!runtime) return { status: 'offline' as const, ageMs: null };
  const observedAt = Math.max(
    Number(runtime.heartbeatAtMs || 0),
    Number(runtime.statePublishedAtMs || 0)
  );
  if (!Number.isFinite(observedAt) || observedAt <= 0) return { status: 'offline' as const, ageMs: null };

  const ageMs = Math.max(0, now - observedAt);
  const staleAfterMs = Math.max(10_000, Number(process.env.REMOTE_CLOUD_STALE_AFTER_MS || 90_000));
  const offlineAfterMs = Math.max(staleAfterMs, Number(process.env.REMOTE_CLOUD_OFFLINE_AFTER_MS || 300_000));
  return {
    status: ageMs <= staleAfterMs ? 'fresh' as const : ageMs <= offlineAfterMs ? 'stale' as const : 'offline' as const,
    ageMs
  };
}

export class CloudControlService {
  private readonly now: () => number;
  private readonly limiter: CommandRateLimiter;

  constructor(
    private readonly store: CloudControlStore,
    options: { now?: () => number; limiter?: CommandRateLimiter } = {}
  ) {
    this.now = options.now || (() => Date.now());
    this.limiter = options.limiter || new FixedWindowCommandRateLimiter();
  }

  async listInstallations(principal: CloudPrincipal) {
    return this.store.listMemberships(principal.uid);
  }

  async getInstallationState(principal: CloudPrincipal, installationId: string) {
    const membership = await this.requireMembership(principal, installationId);
    const runtime = await this.store.getRuntime(installationId);
    return {
      installationId,
      role: membership.role,
      name: membership.name,
      freshness: runtimeFreshness(runtime, this.now()),
      runtime
    };
  }

  async submitCommand(principal: CloudPrincipal, installationId: string, request: unknown) {
    const membership = await this.requireMembership(principal, installationId);
    if (membership.role === 'viewer') {
      throw new CloudControlError(403, 'read_only', 'This account has read-only access to the installation.');
    }
    return this.queueCommand(
      installationId,
      request,
      { kind: 'user', id: principal.uid },
      `user:${principal.uid}:${installationId}`
    );
  }

  async getCommand(principal: CloudPrincipal, installationId: string, commandId: string) {
    await this.requireMembership(principal, installationId);
    return this.requireCommand(installationId, commandId);
  }

  async getInstallationStateForIntegration(installationId: string) {
    if (!installationId) throw new CloudControlError(400, 'invalid_installation', 'Installation ID is required.');
    const runtime = await this.store.getRuntime(installationId);
    return {
      installationId,
      freshness: runtimeFreshness(runtime, this.now()),
      runtime
    };
  }

  submitIntegrationCommand(installationId: string, integrationId: string, request: unknown) {
    if (!installationId) throw new CloudControlError(400, 'invalid_installation', 'Installation ID is required.');
    if (!integrationId) throw new CloudControlError(400, 'invalid_integration', 'Integration ID is required.');
    return this.queueCommand(
      installationId,
      request,
      { kind: 'integration', id: integrationId },
      `integration:${integrationId}:${installationId}`
    );
  }

  getIntegrationCommand(installationId: string, commandId: string) {
    if (!installationId) throw new CloudControlError(400, 'invalid_installation', 'Installation ID is required.');
    return this.requireCommand(installationId, commandId);
  }

  private async queueCommand(
    installationId: string,
    request: unknown,
    requestedBy: { kind: 'user' | 'integration'; id: string },
    rateKey: string
  ) {
    const now = this.now();
    const record = asRecord(request);
    const validated = validateCloudCommandRequest(record.type, record.payload, now);
    if (!this.limiter.consume(rateKey, now)) {
      throw new CloudControlError(429, 'rate_limited', 'Too many remote control requests. Try again shortly.');
    }

    const commandId = crypto.randomUUID();
    const envelope: RemoteCommandEnvelope = {
      version: REMOTE_COMMAND_VERSION,
      commandId,
      installationId,
      type: validated.type,
      payload: validated.payload as any,
      createdAt: now,
      expiresAt: now + defaultCommandTtlMs(validated.type),
      requestedBy
    };

    await this.store.createCommand(envelope);
    return {
      commandId,
      installationId,
      type: envelope.type,
      status: 'queued' as const,
      createdAt: envelope.createdAt,
      expiresAt: envelope.expiresAt
    };
  }

  private async requireCommand(installationId: string, commandId: string) {
    const command = await this.store.getCommand(installationId, commandId);
    if (!command) throw new CloudControlError(404, 'not_found', 'Remote command was not found.');
    return command;
  }

  private async requireMembership(principal: CloudPrincipal, installationId: string) {
    if (!installationId) throw new CloudControlError(400, 'invalid_installation', 'Installation ID is required.');
    const membership = await this.store.getMembership(installationId, principal.uid);
    if (!membership) {
      throw new CloudControlError(403, 'forbidden', 'This account cannot access that installation.');
    }
    return membership;
  }
}
