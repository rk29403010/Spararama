import fs from 'node:fs/promises';
import path from 'node:path';
import type { RemoteCommandResult } from './types';

export interface RemoteCommandLedger {
  get(commandId: string): Promise<RemoteCommandResult | undefined>;
  record(result: RemoteCommandResult): Promise<void>;
}

export class MemoryRemoteCommandLedger implements RemoteCommandLedger {
  private readonly entries = new Map<string, RemoteCommandResult>();

  async get(commandId: string) {
    return this.entries.get(commandId);
  }

  async record(result: RemoteCommandResult) {
    this.entries.set(result.commandId, result);
  }
}

interface LedgerFile {
  version: 1;
  entries: RemoteCommandResult[];
}

export class FileRemoteCommandLedger implements RemoteCommandLedger {
  readonly filePath: string;
  private writeChain = Promise.resolve();

  constructor(
    baseDir = process.env.REMOTE_STATE_DIR || path.join(process.cwd(), 'data', 'remote'),
    private readonly maxEntries = 500
  ) {
    this.filePath = path.join(baseDir, 'command-ledger.json');
  }

  async get(commandId: string) {
    const state = await this.load();
    return state.entries.find(entry => entry.commandId === commandId);
  }

  record(result: RemoteCommandResult) {
    const operation = this.writeChain.then(
      () => this.recordInternal(result),
      () => this.recordInternal(result)
    );
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async recordInternal(result: RemoteCommandResult) {
    const state = await this.load();
    const entries = state.entries.filter(entry => entry.commandId !== result.commandId);
    entries.push(result);
    entries.sort((a, b) => b.completedAt - a.completedAt);

    const next: LedgerFile = {
      version: 1,
      entries: entries.slice(0, Math.max(1, this.maxEntries))
    };

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, this.filePath);
  }

  private async load(): Promise<LedgerFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      return {
        version: 1,
        entries: Array.isArray(parsed?.entries) ? parsed.entries : []
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { version: 1, entries: [] };
      throw error;
    }
  }
}
