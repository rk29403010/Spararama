import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { Express, Request, Response } from 'express';

const execFileAsync = promisify(execFile);

export function isSystemUpdateEnabled(env: NodeJS.ProcessEnv = process.env) {
  return String(env.PREFIX || '').includes('com.termux') && env.SPAR_UI_UPDATE_ENABLED !== '0';
}

export function systemUpdateRequired(input: {
  currentBranch?: string;
  targetBranch: string;
  localCommit: string;
  remoteCommit: string;
}) {
  return input.currentBranch !== input.targetBranch || input.localCommit !== input.remoteCommit;
}

type UpdateState = 'idle' | 'running' | 'succeeded' | 'failed';
export type SystemUpdateOutcome = 'started' | 'up-to-date';

export interface SystemUpdateStatus {
  supported: boolean;
  reason?: string;
  branch?: string;
  currentBranch?: string;
  commit?: string;
  dirty?: boolean;
  outcome?: SystemUpdateOutcome;
  update: {
    state: UpdateState;
    startedAt?: number;
    finishedAt?: number;
    exitCode?: number;
    message?: string;
  };
}

class SystemUpdateError extends Error {
  constructor(message: string, readonly statusCode = 409) {
    super(message);
  }
}

interface SystemUpdateServiceOptions {
  repoPath?: string;
  branch?: string;
  stateDir?: string;
  enabled?: boolean;
}

async function readText(filePath: string) {
  try { return (await fsp.readFile(filePath, 'utf8')).trim(); } catch (error: any) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function fileMtime(filePath: string) {
  try { return (await fsp.stat(filePath)).mtimeMs; } catch (error: any) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function processAlive(pid: number | undefined) {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export class SystemUpdateService {
  readonly repoPath: string;
  readonly branch: string;
  readonly stateDir: string;
  readonly enabled: boolean;
  readonly runnerCopyPath: string;
  readonly pidPath: string;
  readonly startedPath: string;
  readonly exitPath: string;
  readonly logPath: string;
  readonly noOpenBin: string;

  constructor(options: SystemUpdateServiceOptions = {}) {
    this.repoPath = path.resolve(options.repoPath || process.env.SPAR_REPO || process.cwd());
    this.branch = options.branch || process.env.SPAR_BRANCH || 'chatgpt-dev';
    const xdgState = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
    this.stateDir = path.resolve(options.stateDir || path.join(xdgState, 'spararama-phone'));
    this.enabled = options.enabled ?? isSystemUpdateEnabled();
    this.runnerCopyPath = path.join(this.stateDir, 'ui-update-runner.sh');
    this.pidPath = path.join(this.stateDir, 'ui-update.pid');
    this.startedPath = path.join(this.stateDir, 'ui-update.started');
    this.exitPath = path.join(this.stateDir, 'ui-update.exit');
    this.logPath = path.join(this.stateDir, 'ui-update.log');
    this.noOpenBin = path.join(this.stateDir, 'ui-update-bin');
  }

  private async git(args: string[], timeout = 5_000) {
    const result = await execFileAsync('git', args, {
      cwd: this.repoPath,
      timeout,
      maxBuffer: 256 * 1024
    });
    return String(result.stdout || '').trim();
  }

  private async updateState() {
    const pidText = await readText(this.pidPath);
    const startedText = await readText(this.startedPath);
    const exitText = await readText(this.exitPath);
    const pid = pidText === '' ? undefined : Number(pidText);
    const startedAt = startedText === '' ? undefined : Number(startedText);
    const exitCode = exitText === '' ? undefined : Number(exitText);

    if (processAlive(pid)) {
      return {
        state: 'running' as const,
        ...(startedAt !== undefined && Number.isFinite(startedAt) ? { startedAt } : {})
      };
    }

    const finishedAt = await fileMtime(this.exitPath);
    if (exitCode !== undefined && Number.isFinite(exitCode)) {
      const state = exitCode === 0 ? 'succeeded' as const : 'failed' as const;
      let message: string | undefined;
      if (state === 'failed') {
        const log = await readText(this.logPath);
        const lines = log.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        message = lines.slice(-6).join(' · ') || 'Update failed. Check the Termux update log.';
      }
      return {
        state,
        ...(startedAt !== undefined && Number.isFinite(startedAt) ? { startedAt } : {}),
        ...(finishedAt !== undefined ? { finishedAt } : {}),
        exitCode,
        ...(message ? { message } : {})
      };
    }

    if (startedAt !== undefined && Number.isFinite(startedAt)) {
      return {
        state: 'failed' as const,
        startedAt,
        message: 'The update process stopped without reporting a result.'
      };
    }

    return { state: 'idle' as const };
  }

  async status(): Promise<SystemUpdateStatus> {
    if (!this.enabled) {
      return {
        supported: false,
        reason: 'Update/restart is only available on the Termux-hosted backend.',
        update: { state: 'idle' }
      };
    }

    let commit: string | undefined;
    let currentBranch: string | undefined;
    let dirty: boolean | undefined;
    try {
      [commit, currentBranch] = await Promise.all([
        this.git(['rev-parse', '--short=10', 'HEAD']),
        this.git(['branch', '--show-current'])
      ]);
      dirty = Boolean(await this.git(['status', '--porcelain']));
    } catch (error: any) {
      return {
        supported: false,
        reason: error?.message || 'Unable to inspect the Spararama checkout.',
        update: await this.updateState()
      };
    }

    return {
      supported: true,
      branch: this.branch,
      currentBranch,
      commit,
      dirty,
      update: await this.updateState()
    };
  }

  private async hasUpdate(status: SystemUpdateStatus) {
    try {
      await this.git(['fetch', 'origin', this.branch], 20_000);
      const [localCommit, remoteCommit] = await Promise.all([
        this.git(['rev-parse', 'HEAD']),
        this.git(['rev-parse', `origin/${this.branch}`])
      ]);
      return systemUpdateRequired({
        currentBranch: status.currentBranch,
        targetBranch: this.branch,
        localCommit,
        remoteCommit
      });
    } catch (error: any) {
      throw new SystemUpdateError(
        `Could not check GitHub for updates. Existing server has not been stopped. ${error?.message || ''}`.trim(),
        502
      );
    }
  }

  async startUpdate(): Promise<SystemUpdateStatus> {
    const status = await this.status();
    if (!status.supported) throw new SystemUpdateError(status.reason || 'UI update is unavailable.');
    if (status.update.state === 'running') throw new SystemUpdateError('An update is already running.');
    if (status.dirty) throw new SystemUpdateError('The checkout has local changes. Update is disabled until they are resolved.');

    if (!(await this.hasUpdate(status))) {
      return {
        ...(await this.status()),
        outcome: 'up-to-date',
        update: { state: 'idle', message: 'Already up to date.' }
      };
    }

    const sourceRunner = path.join(this.repoPath, 'scripts', 'termux', 'spar');
    try {
      await fsp.access(sourceRunner, fs.constants.R_OK);
    } catch {
      throw new SystemUpdateError('The Termux runner is missing from this checkout.');
    }

    await fsp.mkdir(this.stateDir, { recursive: true });
    await fsp.copyFile(sourceRunner, this.runnerCopyPath);
    await fsp.chmod(this.runnerCopyPath, 0o700);
    await fsp.mkdir(this.noOpenBin, { recursive: true });
    const noOpen = path.join(this.noOpenBin, 'termux-open-url');
    await fsp.writeFile(noOpen, '#!/data/data/com.termux/files/usr/bin/bash\nexit 0\n', 'utf8');
    await fsp.chmod(noOpen, 0o700);
    await fsp.writeFile(this.startedPath, `${Date.now()}\n`, 'utf8');
    await fsp.writeFile(this.logPath, '', 'utf8');
    await fsp.rm(this.exitPath, { force: true });
    await fsp.rm(this.pidPath, { force: true });

    const logFd = fs.openSync(this.logPath, 'a');
    const wrapper = [
      'set +e',
      'trap \'rm -f "$3"\' EXIT',
      'bash "$1" update',
      'code=$?',
      'printf "%s\\n" "$code" > "$2"',
      'exit "$code"'
    ].join('\n');

    const child = spawn('bash', ['-c', wrapper, 'spar-ui-update', this.runnerCopyPath, this.exitPath, this.pidPath], {
      cwd: this.repoPath,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        PATH: `${this.noOpenBin}:${process.env.PATH || ''}`,
        SPAR_REPO: this.repoPath,
        SPAR_BRANCH: this.branch
      }
    });
    fs.closeSync(logFd);

    if (!child.pid) throw new SystemUpdateError('Could not start the detached updater.', 500);
    await fsp.writeFile(this.pidPath, `${child.pid}\n`, 'utf8');
    child.unref();

    return { ...(await this.status()), outcome: 'started' };
  }
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      const statusCode = Number(error?.statusCode) || 500;
      res.status(statusCode).json({ error: error?.message || 'System update request failed.' });
    });
  };
}

export function registerSystemUpdateRoutes(app: Express, updater = new SystemUpdateService()) {
  app.get('/api/system/update', asyncRoute(async (_req, res) => {
    res.json(await updater.status());
  }));

  app.post('/api/system/update', asyncRoute(async (req, res) => {
    if (req.get('x-spararama-developer') !== 'update-restart') {
      res.status(403).json({ error: 'Developer update header required.' });
      return;
    }
    const result = await updater.startUpdate();
    res.status(result.outcome === 'started' ? 202 : 200).json(result);
  }));
}
