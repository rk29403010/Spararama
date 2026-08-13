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

      return this.parsePending(text);
    });
  }

  private parsePending(text: string): TelemetrySample[] {
      const samples: TelemetrySample[] = [];
      let lineNumber = 0;
      for (const line of text.split(/\r?\n/)) {
        lineNumber += 1;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          samples.push(JSON.parse(trimmed));
        } catch {
          throw new Error(`Malformed telemetry queue entry at line ${lineNumber}; queue was left intact.`);
        }
      }
      return samples;
  }

  async replacePending(samples: TelemetrySample[]) {
    return this.serialized(async () => {
      await this.ensureDir();
      const data = samples.length ? `${samples.map(sample => JSON.stringify(sample)).join('\n')}\n` : '';
      await fs.writeFile(this.pendingPath, data, 'utf8');
    });
  }

  async acknowledgePending(uploadedIds: string[]) {
    const acknowledged = new Set(uploadedIds);
    return this.serialized(async () => {
      await this.ensureDir();
      let text = '';
      try {
        text = await fs.readFile(this.pendingPath, 'utf8');
      } catch (error: any) {
        if (error?.code === 'ENOENT') return;
        throw error;
      }
      const remaining = this.parsePending(text).filter(sample => !acknowledged.has(sample.id));
      const data = remaining.length ? `${remaining.map(sample => JSON.stringify(sample)).join('\n')}\n` : '';
      await fs.writeFile(this.pendingPath, data, 'utf8');
    });
  }

  async pendingCount() {
    return (await this.readPending()).length;
  }

  async readRecent(limit = 200) {
    return this.serialized(async () => {
      await this.ensureDir();
      let text = '';
      try {
        text = await fs.readFile(this.archivePath, 'utf8');
      } catch (error: any) {
        if (error?.code === 'ENOENT') return { samples: [], total: 0 };
        throw error;
      }

      const samples: TelemetrySample[] = [];
      let lineNumber = 0;
      for (const line of text.split(/\r?\n/)) {
        lineNumber += 1;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          samples.push(JSON.parse(trimmed));
        } catch {
          throw new Error(`Malformed telemetry archive entry at line ${lineNumber}; archive was left intact.`);
        }
      }

      const safeLimit = Math.max(1, Math.min(500, Math.floor(limit) || 200));
      return {
        samples: samples.slice(-safeLimit).reverse(),
        total: samples.length
      };
    });
  }
}
