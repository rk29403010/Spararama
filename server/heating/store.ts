import fs from 'node:fs/promises';
import path from 'node:path';
import type { HeatingEvent, HeatingNotification, HeatingSchedule } from './types';

interface HeatingStateFile {
  schedules: HeatingSchedule[];
  notifications: HeatingNotification[];
}

const EMPTY_STATE: HeatingStateFile = { schedules: [], notifications: [] };

export class HeatingStore {
  readonly baseDir: string;
  readonly statePath: string;
  readonly eventsPath: string;

  constructor(baseDir = process.env.HEATING_DIR || path.join(process.cwd(), 'data', 'heating')) {
    this.baseDir = baseDir;
    this.statePath = path.join(baseDir, 'state.json');
    this.eventsPath = path.join(baseDir, 'events.ndjson');
  }

  async load(): Promise<HeatingStateFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      return {
        schedules: Array.isArray(parsed?.schedules) ? parsed.schedules : [],
        notifications: Array.isArray(parsed?.notifications) ? parsed.notifications : []
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { ...EMPTY_STATE, schedules: [], notifications: [] };
      throw error;
    }
  }

  async save(state: HeatingStateFile) {
    await fs.mkdir(this.baseDir, { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, this.statePath);
  }

  async appendEvent(event: HeatingEvent) {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}
