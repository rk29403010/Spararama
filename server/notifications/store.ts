import fs from 'node:fs/promises';
import path from 'node:path';
import type { NotificationDelivery, NotificationEventRecord, NotificationStateFile } from './types';

const EMPTY_STATE: NotificationStateFile = { notifications: [], deliveries: [] };

export class NotificationStore {
  readonly baseDir: string;
  readonly statePath: string;
  readonly eventsPath: string;
  readonly deliveriesPath: string;
  private appendQueue: Promise<void> = Promise.resolve();

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

  appendEvent(event: NotificationEventRecord) {
    return this.appendText(this.eventsPath, `${JSON.stringify(event)}\n`);
  }

  appendDelivery(delivery: NotificationDelivery) {
    return this.appendText(this.deliveriesPath, `${JSON.stringify(delivery)}\n`);
  }

  appendDeliveries(deliveries: NotificationDelivery[]) {
    if (!deliveries.length) return Promise.resolve();
    return this.appendText(
      this.deliveriesPath,
      deliveries.map(delivery => JSON.stringify(delivery)).join('\n') + '\n'
    );
  }

  private appendText(filePath: string, text: string) {
    const run = this.appendQueue.then(async () => {
      await fs.mkdir(this.baseDir, { recursive: true });
      await fs.appendFile(filePath, text, 'utf8');
    });
    this.appendQueue = run.then(() => undefined, () => undefined);
    return run;
  }
}
