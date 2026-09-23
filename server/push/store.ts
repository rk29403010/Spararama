import fs from 'node:fs/promises';
import path from 'node:path';
import type { PushRegistration, PushRegistryState } from './types';

export const PUSH_TOKEN_MAX_CHARS = 4096;
export const PUSH_USER_AGENT_MAX_CHARS = 500;
export const PUSH_LABEL_MAX_CHARS = 120;
export const DEFAULT_PUSH_MAX_REGISTRATIONS = 20;
export const DEFAULT_PUSH_REGISTRY_MAX_BYTES = 256 * 1024;

export class PushRegistrationStoreError extends Error {
  constructor(
    readonly code: 'invalid_registration' | 'registry_full' | 'registry_too_large',
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

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

  upsert(input: { token: string; userAgent?: string; label?: string }) {
    return this.mutate(async () => {
      const token = input.token.trim();
      if (!token || token.length < 20 || token.length > PUSH_TOKEN_MAX_CHARS) {
        throw new PushRegistrationStoreError(
          'invalid_registration',
          400,
          `FCM registration token must be between 20 and ${PUSH_TOKEN_MAX_CHARS} characters.`
        );
      }
      if (input.userAgent && input.userAgent.length > PUSH_USER_AGENT_MAX_CHARS) {
        throw new PushRegistrationStoreError('invalid_registration', 400, 'Push user-agent value is too long.');
      }
      if (input.label && input.label.length > PUSH_LABEL_MAX_CHARS) {
        throw new PushRegistrationStoreError('invalid_registration', 400, 'Push registration label is too long.');
      }

      const state = await this.load();
      const now = Date.now();
      let registration = state.registrations.find(item => item.token === token);
      if (registration) {
        registration.updatedAt = now;
        registration.userAgent = input.userAgent || registration.userAgent;
        registration.label = input.label || registration.label;
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
          userAgent: input.userAgent,
          label: input.label
        };
        state.registrations.push(registration);
      }
      await this.save(state);
      return registration;
    });
  }

  removeById(id: string) {
    return this.mutate(async () => {
      const state = await this.load();
      const before = state.registrations.length;
      state.registrations = state.registrations.filter(item => item.id !== id);
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

  async list() {
    return (await this.load()).registrations;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation);
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}
