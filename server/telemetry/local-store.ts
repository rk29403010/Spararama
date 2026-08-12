import fs from 'node:fs/promises';
import path from 'node:path';
import type { TelemetrySample } from './types';

export class LocalTelemetryStore {
  readonly archivePath: string;
  readonly pendingPath: string;
  private operation = Promise.resolve();

  constructor(baseDir = process.env.TELEMETRY_DIR || path.join(process.cwd(), 'data', 'telemetry')) {
    this.archivePath = path.join(baseDir, 'telemetry.ndjson');
    this.pendingPath = path.join(baseDir, 'pending.ndjson');
  }

  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operation.then(action, action);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async ensureDir() {
    await fs.mkdir(path.dirname(this.archivePath), { recursive: true });
  }

  async append(sample: TelemetrySample) {
    return this.serialized(async () => {
      await this.ensureDir();
      const line = `${JSON.stringify(sample)}\n`;
      await fs.appendFile(this.archivePath, line, 'utf8');
      await fs.appendFile(this.pendingPath, line, 'utf8');
    });
  }

  async readPending(): Promise<TelemetrySample[]> {
    return this.serialized(async () => {
      await this.ensureDir();
      let text = '';
      try {
        text = await fs.readFile(this.pendingPath, 'utf8');
      } catch (error: any) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }

      const samples: TelemetrySample[] = [];
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          samples.push(JSON.parse(trimmed));
        } catch (error) {
          console.warn('Skipping malformed telemetry queue line', error);
        }
      }
      return samples;
    });
  }

  async replacePending(samples: TelemetrySample[]) {
    return this.serialized(async () => {
      await this.ensureDir();
      const data = samples.length ? `${samples.map(sample => JSON.stringify(sample)).join('\n')}\n` : '';
      await fs.writeFile(this.pendingPath, data, 'utf8');
    });
  }

  async pendingCount() {
    return (await this.readPending()).length;
  }
}
