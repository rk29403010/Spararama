import fs from 'node:fs/promises';
import path from 'node:path';
import type { NotificationGroup } from './types';

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  'heating.action_required',
  'heating.progress',
  'heating.schedule',
  'equipment',
  'water_care',
  'system'
];

export type NotificationGroupPreferences = Record<NotificationGroup, boolean>;

export interface PersonalNotificationPreferences {
  push: NotificationGroupPreferences;
}

export interface SharedNotificationPreferences {
  alexa: NotificationGroupPreferences;
}

interface PreferenceState {
  users: Record<string, { push?: Partial<NotificationGroupPreferences> }>;
  shared?: { alexa?: Partial<NotificationGroupPreferences> };
}

export const DEFAULT_PERSONAL_PUSH: NotificationGroupPreferences = {
  'heating.action_required': true,
  'heating.progress': true,
  'heating.schedule': true,
  equipment: true,
  water_care: true,
  system: true
};

export const DEFAULT_SHARED_ALEXA: NotificationGroupPreferences = {
  'heating.action_required': true,
  'heating.progress': true,
  'heating.schedule': false,
  equipment: true,
  water_care: false,
  system: false
};

function normalizeGroupPreferences(
  value: Partial<Record<NotificationGroup, unknown>> | undefined,
  defaults: NotificationGroupPreferences
): NotificationGroupPreferences {
  return Object.fromEntries(NOTIFICATION_GROUPS.map(group => [
    group,
    typeof value?.[group] === 'boolean' ? Boolean(value[group]) : defaults[group]
  ])) as NotificationGroupPreferences;
}

function sanitizePatch(value: unknown): Partial<NotificationGroupPreferences> {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  const result: Partial<NotificationGroupPreferences> = {};
  for (const group of NOTIFICATION_GROUPS) {
    if (typeof input[group] === 'boolean') result[group] = input[group] as boolean;
  }
  return result;
}

export class NotificationPreferenceStore {
  readonly statePath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(baseDir = process.env.NOTIFICATION_DIR || path.join(process.cwd(), 'data', 'notifications')) {
    this.statePath = path.join(baseDir, 'preferences.json');
  }

  private async load(): Promise<PreferenceState> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      return {
        users: parsed?.users && typeof parsed.users === 'object' ? parsed.users : {},
        shared: parsed?.shared && typeof parsed.shared === 'object' ? parsed.shared : {}
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { users: {}, shared: {} };
      throw error;
    }
  }

  private async save(state: PreferenceState) {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, this.statePath);
  }

  async getUser(uid: string): Promise<PersonalNotificationPreferences> {
    const state = await this.load();
    return {
      push: normalizeGroupPreferences(state.users[uid]?.push, DEFAULT_PERSONAL_PUSH)
    };
  }

  updateUser(uid: string, pushPatch: unknown) {
    return this.mutate(async () => {
      const state = await this.load();
      const current = normalizeGroupPreferences(state.users[uid]?.push, DEFAULT_PERSONAL_PUSH);
      const next = { ...current, ...sanitizePatch(pushPatch) };
      state.users[uid] = { ...(state.users[uid] || {}), push: next };
      await this.save(state);
      return { push: next } satisfies PersonalNotificationPreferences;
    });
  }

  removeUser(uid: string) {
    return this.mutate(async () => {
      const state = await this.load();
      if (!(uid in state.users)) return false;
      delete state.users[uid];
      await this.save(state);
      return true;
    });
  }

  async getShared(): Promise<SharedNotificationPreferences> {
    const state = await this.load();
    return {
      alexa: normalizeGroupPreferences(state.shared?.alexa, DEFAULT_SHARED_ALEXA)
    };
  }

  updateShared(alexaPatch: unknown) {
    return this.mutate(async () => {
      const state = await this.load();
      const current = normalizeGroupPreferences(state.shared?.alexa, DEFAULT_SHARED_ALEXA);
      const next = { ...current, ...sanitizePatch(alexaPatch) };
      state.shared = { ...(state.shared || {}), alexa: next };
      await this.save(state);
      return { alexa: next } satisfies SharedNotificationPreferences;
    });
  }

  async userPushEnabled(uid: string, group: NotificationGroup) {
    return (await this.getUser(uid)).push[group];
  }

  async alexaEnabled(group: NotificationGroup) {
    return (await this.getShared()).alexa[group];
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation);
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}
