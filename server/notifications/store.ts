import fs from 'node:fs/promises';
import path from 'node:path';
import type { NotificationDelivery, NotificationEventRecord, NotificationStateFile } from './types';

const EMPTY_STATE: NotificationStateFile = { notifications: [], deliveries: [] };

export class NotificationStore {
  readonly baseDir: string;
  readonly statePath: string;
  readonly eventsPath: string;
  readonly deliveriesPath: string;

  constructor(baseDir = process.env.NOTIFICATION_DIR || path.join(process.cwd(), 'data', 'notifications')) {
    this.baseDir = baseDir;
    this.statePath = path.join(baseDir, 'state.json');
    this.eventsPath = path.join(baseDir, 'events.ndjson');
    this.deliveriesPath = path.join(baseDir, 'deliveries.ndjson');
  }

  async load(): Promise<NotificationStateFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      return {
        notifications: Array.isArray(parsed?.notifications) ? parsed.notifications : [],
        deliveries: Array.isArray(parsed?.deliveries) ? parsed.deliveries : []
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { ...EMPTY_STATE, notifications: [], deliveries: [] };
      throw error;
    }
  }

  async save(state: NotificationStateFile) {
    await fs.mkdir(this.baseDir, { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, this.statePath);
  }

  async appendEvent(event: NotificationEventRecord) {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async appendDelivery(delivery: NotificationDelivery) {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(this.deliveriesPath, `${JSON.stringify(delivery)}\n`, 'utf8');
  }

  async appendDeliveries(deliveries: NotificationDelivery[]) {
    if (!deliveries.length) return;
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.appendFile(this.deliveriesPath, deliveries.map(delivery => JSON.stringify(delivery)).join('\n') + '\n', 'utf8');
  }
}
