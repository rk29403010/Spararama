import fs from 'node:fs/promises';
import path from 'node:path';
import type { PushRegistration, PushRegistryState, PushTargetDeliveryResult } from './types';

export const PUSH_TOKEN_MAX_CHARS = 4096;
export const PUSH_USER_AGENT_MAX_CHARS = 500;
export const PUSH_LABEL_MAX_CHARS = 120;
export const PUSH_DEVICE_NAME_MAX_CHARS = 120;
export const PUSH_DEVICE_ID_MAX_CHARS = 120;
export const PUSH_USER_UID_MAX_CHARS = 256;
export const DEFAULT_PUSH_MAX_REGISTRATIONS = 20;
export const DEFAULT_PUSH_REGISTRY_MAX_BYTES = 256 * 1024;

export class PushRegistrationStoreError extends Error {
  constructor(
    readonly code: 'invalid_registration' | 'registry_full' | 'registry_too_large' | 'registration_not_found',
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export interface PushRegistrationStoreOptions {
  maxRegistrations?: number;
  maxRegistryBytes?: number;
}

export interface PushRegistrationInput {
  token: string;
  userUid?: string;
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  label?: string;
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalTrimmed(value: string | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed || undefined;
}

export class PushRegistrationStore {
  readonly statePath: string;
  readonly maxRegistrations: number;
  readonly maxRegistryBytes: number;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    baseDir = process.env.PUSH_REGISTRATION_DIR || process.env.PUSH_DIR || path.join(process.cwd(), 'data', 'push'),
    options: PushRegistrationStoreOptions = {}
  ) {
    this.statePath = path.join(baseDir, 'registrations.json');
    this.maxRegistrations = options.maxRegistrations
      ?? positiveInteger(process.env.PUSH_MAX_REGISTRATIONS, DEFAULT_PUSH_MAX_REGISTRATIONS);
    this.maxRegistryBytes = options.maxRegistryBytes
      ?? positiveInteger(process.env.PUSH_REGISTRY_MAX_BYTES, DEFAULT_PUSH_REGISTRY_MAX_BYTES);
  }

  async load(): Promise<PushRegistryState> {
    try {
      const stat = await fs.stat(this.statePath);
      if (stat.size > this.maxRegistryBytes) {
        console.warn(`Push registration registry exceeds ${this.maxRegistryBytes} bytes; ignoring it until it is replaced.`);
        return { registrations: [] };
      }
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      const registrations = Array.isArray(parsed?.registrations)
        ? parsed.registrations
          .filter((item: any) => typeof item?.token === 'string' && item.token.length <= PUSH_TOKEN_MAX_CHARS)
          .sort((a: PushRegistration, b: PushRegistration) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
          .slice(0, this.maxRegistrations)
        : [];
      return { registrations };
    } catch (error: any) {
      if (error?.code !== 'ENOENT') console.warn(`Unable to load push registrations: ${error?.message || String(error)}`);
      return { registrations: [] };
    }
  }

  async save(state: PushRegistryState) {
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > this.maxRegistryBytes) {
      throw new PushRegistrationStoreError(
        'registry_too_large',
        507,
        'Push registration storage limit reached.'
      );
    }
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    await fs.writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, this.statePath);
  }

  upsert(input: PushRegistrationInput) {
    return this.mutate(async () => {
      const token = input.token.trim();
      const userUid = optionalTrimmed(input.userUid);
      const deviceId = optionalTrimmed(input.deviceId);
      const deviceName = optionalTrimmed(input.deviceName);
      const userAgent = optionalTrimmed(input.userAgent);
      const label = optionalTrimmed(input.label);

      if (!token || token.length < 20 || token.length > PUSH_TOKEN_MAX_CHARS) {
        throw new PushRegistrationStoreError(
          'invalid_registration',
          400,
          `FCM registration token must be between 20 and ${PUSH_TOKEN_MAX_CHARS} characters.`
        );
      }
      if (userUid && userUid.length > PUSH_USER_UID_MAX_CHARS) {
        throw new PushRegistrationStoreError('invalid_registration', 400, 'Push user ID is too long.');
      }
      if (deviceId && deviceId.length > PUSH_DEVICE_ID_MAX_CHARS) {
        throw new PushRegistrationStoreError('invalid_registration', 400, 'Push device ID is too long.');
      }
      if (deviceName && deviceName.length > PUSH_DEVICE_NAME_MAX_CHARS) {
        throw new PushRegistrationStoreError('invalid_registration', 400, 'Push device name is too long.');
      }
      if (userAgent && userAgent.length > PUSH_USER_AGENT_MAX_CHARS) {
        throw new PushRegistrationStoreError('invalid_registration', 400, 'Push user-agent value is too long.');
      }
      if (label && label.length > PUSH_LABEL_MAX_CHARS) {
        throw new PushRegistrationStoreError('invalid_registration', 400, 'Push registration label is too long.');
      }

      const state = await this.load();
      const now = Date.now();
      let registration = state.registrations.find(item => item.token === token);
      if (!registration && userUid && deviceId) {
        registration = state.registrations.find(item => item.userUid === userUid && item.deviceId === deviceId);
      }

      if (registration) {
        registration.token = token;
        registration.updatedAt = now;
        registration.lastRegisteredAt = now;
        registration.userUid = userUid || registration.userUid;
        registration.deviceId = deviceId || registration.deviceId;
        registration.deviceName = deviceName || registration.deviceName;
        registration.userAgent = userAgent || registration.userAgent;
        registration.label = label || registration.label;
      } else {
        if (state.registrations.length >= this.maxRegistrations) {
          throw new PushRegistrationStoreError(
            'registry_full',
            409,
            `This Spararama installation already has the maximum ${this.maxRegistrations} push registrations.`
          );
        }
        registration = {
          id: crypto.randomUUID(),
          token,
          createdAt: now,
          updatedAt: now,
          lastRegisteredAt: now,
          userUid,
          deviceId,
          deviceName,
          userAgent,
          label,
          consecutiveDeliveryFailures: 0
        };
        state.registrations.push(registration);
      }
      await this.save(state);
      return registration;
    });
  }

  renameById(id: string, userUid: string, deviceName: string) {
    return this.mutate(async () => {
      const name = deviceName.trim();
      if (!name || name.length > PUSH_DEVICE_NAME_MAX_CHARS) {
        throw new PushRegistrationStoreError(
          'invalid_registration',
          400,
          `Device name must be between 1 and ${PUSH_DEVICE_NAME_MAX_CHARS} characters.`
        );
      }
      const state = await this.load();
      const registration = state.registrations.find(item => item.id === id && item.userUid === userUid);
      if (!registration) {
        throw new PushRegistrationStoreError('registration_not_found', 404, 'Push device not found for this user.');
      }
      registration.deviceName = name;
      registration.updatedAt = Date.now();
      await this.save(state);
      return registration;
    });
  }

  removeById(id: string, userUid?: string) {
    return this.mutate(async () => {
      const state = await this.load();
      const before = state.registrations.length;
      state.registrations = state.registrations.filter(item => item.id !== id || Boolean(userUid && item.userUid !== userUid));
      if (state.registrations.length !== before) await this.save(state);
      return state.registrations.length !== before;
    });
  }

  removeTokens(tokens: string[]) {
    if (!tokens.length) return Promise.resolve(0);
    return this.mutate(async () => {
      const invalid = new Set(tokens);
      const state = await this.load();
      const before = state.registrations.length;
      state.registrations = state.registrations.filter(item => !invalid.has(item.token));
      const removed = before - state.registrations.length;
      if (removed) await this.save(state);
      return removed;
    });
  }

  recordDeliveryResults(results: PushTargetDeliveryResult[], attemptedAt = Date.now()) {
    if (!results.length) return Promise.resolve();
    return this.mutate(async () => {
      const state = await this.load();
      let changed = false;
      for (const result of results) {
        const registration = state.registrations.find(item => item.id === result.registrationId);
        if (!registration) continue;
        changed = true;
        registration.lastDeliveryAttemptAt = attemptedAt;
        registration.updatedAt = Math.max(registration.updatedAt || 0, attemptedAt);
        if (result.success) {
          registration.lastProviderAcceptedAt = attemptedAt;
          registration.lastDeliveryErrorAt = undefined;
          registration.lastDeliveryErrorCode = undefined;
          registration.lastDeliveryErrorMessage = undefined;
          registration.consecutiveDeliveryFailures = 0;
        } else {
          registration.lastDeliveryErrorAt = attemptedAt;
          registration.lastDeliveryErrorCode = result.errorCode;
          registration.lastDeliveryErrorMessage = result.errorMessage;
          registration.consecutiveDeliveryFailures = (registration.consecutiveDeliveryFailures || 0) + 1;
        }
      }
      if (changed) await this.save(state);
    });
  }

  async list(userUid?: string) {
    const registrations = (await this.load()).registrations;
    return userUid ? registrations.filter(item => item.userUid === userUid) : registrations;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation);
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}
