import fs from 'node:fs/promises';
import path from 'node:path';
import type { PushRegistration, PushRegistryState } from './types';

export class PushRegistrationStore {
  readonly statePath: string;

  constructor(baseDir = process.env.PUSH_DIR || path.join(process.cwd(), 'data', 'push')) {
    this.statePath = path.join(baseDir, 'registrations.json');
  }

  async load(): Promise<PushRegistryState> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      return { registrations: Array.isArray(parsed?.registrations) ? parsed.registrations : [] };
    } catch (error: any) {
      if (error?.code !== 'ENOENT') console.warn(`Unable to load push registrations: ${error?.message || String(error)}`);
      return { registrations: [] };
    }
  }

  async save(state: PushRegistryState) {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, this.statePath);
  }

  async upsert(input: { token: string; userAgent?: string; label?: string }) {
    const token = input.token.trim();
    if (!token || token.length < 20) throw new Error('A valid FCM registration token is required.');
    const state = await this.load();
    const now = Date.now();
    let registration = state.registrations.find(item => item.token === token);
    if (registration) {
      registration.updatedAt = now;
      registration.userAgent = input.userAgent || registration.userAgent;
      registration.label = input.label || registration.label;
    } else {
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
  }

  async removeById(id: string) {
    const state = await this.load();
    const before = state.registrations.length;
    state.registrations = state.registrations.filter(item => item.id !== id);
    if (state.registrations.length !== before) await this.save(state);
    return state.registrations.length !== before;
  }

  async removeTokens(tokens: string[]) {
    if (!tokens.length) return 0;
    const invalid = new Set(tokens);
    const state = await this.load();
    const before = state.registrations.length;
    state.registrations = state.registrations.filter(item => !invalid.has(item.token));
    const removed = before - state.registrations.length;
    if (removed) await this.save(state);
    return removed;
  }

  async list() {
    return (await this.load()).registrations;
  }
}
