#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_DIR = path.join(ROOT, '.local');
const LOG_DIR = path.join(LOCAL_DIR, 'logs');
const PID_DIR = path.join(LOCAL_DIR, 'pids');
const IS_WINDOWS = process.platform === 'win32';
const PNPM = IS_WINDOWS ? 'pnpm.cmd' : 'pnpm';

const SERVICES = {
  cleverspa: {
    port: 8787,
    healthUrl: 'http://127.0.0.1:8787/api/status',
    args: ['--env-file-if-exists=.env', 'services/cleverspa/src/server.js'],
    env: {},
    log: 'cleverspa-service'
  },
  spararama: {
    port: 3000,
    healthUrl: 'http://127.0.0.1:3000/api/health',
    args: ['dist/server.cjs'],
    env: { NODE_ENV: 'production' },
    log: 'spararama'
  }
};

function ensureLocalDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(PID_DIR, { recursive: true });
}

function run(command, args, { capture = false, allowFailure = false, shell = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    shell,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error && !allowFailure) throw result.error;
  if ((result.status ?? 1) !== 0 && !allowFailure) {
    const detail = capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.${detail}`);
  }
  return result;
}

function capture(command, args, allowFailure = false) {
  return run(command, args, { capture: true, allowFailure });
}

function runPnpm(args, { capture: captureOutput = false, allowFailure = false } = {}) {
  // npm-installed pnpm is normally a .cmd shim on Windows. Use the Windows
  // command processor only for these short-lived package-manager calls; the
  // long-running Spararama services are spawned directly as Node processes.
  return run(PNPM, args, { capture: captureOutput, allowFailure, shell: IS_WINDOWS });
}

function assertPnpm() {
  const result = runPnpm(['--version'], { capture: true, allowFailure: true });
  if (result.status !== 0) {
    throw new Error('pnpm is required. Install the pinned version with: npm install -g pnpm@11.21.0');
  }
}

function mtime(file) {
  try { return fs.statSync(file).mtimeMs; }
  catch { return 0; }
}

function newestMtime(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '.local') continue;
    newest = Math.max(newest, newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

function dependenciesNeedInstall() {
  const marker = path.join(ROOT, 'node_modules', '.modules.yaml');
  if (!fs.existsSync(marker)) return true;
  const installedAt = mtime(marker);
  return [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    path.join('services', 'cleverspa', 'package.json')
  ].some(file => mtime(path.join(ROOT, file)) > installedAt);
}

function buildNeedsRefresh() {
  const bundle = path.join(ROOT, 'dist', 'server.cjs');
  const index = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(bundle) || !fs.existsSync(index)) return true;
  const builtAt = Math.min(mtime(bundle), mtime(index));
  const inputs = [
    'server.ts', 'src', 'server', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json'
  ];
  return inputs.some(input => newestMtime(path.join(ROOT, input)) > builtAt);
}

function prepare() {
  assertPnpm();
  let dependenciesInstalled = false;
  let built = false;
  if (dependenciesNeedInstall()) {
    console.log('Installing changed dependencies...');
    runPnpm(['install', '--frozen-lockfile']);
    dependenciesInstalled = true;
  } else {
    console.log('Dependencies are current.');
  }
  if (buildNeedsRefresh()) {
    console.log('Building changed source...');
    runPnpm(['build']);
    built = true;
  } else {
    console.log('Production build is current.');
  }
  return { dependenciesInstalled, built };
}

async function getJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isPortOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForJson(url, startupTimeoutMs = 60_000) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const value = await getJson(url, Math.min(3000, remainingMs));
    if (value) return value;
    if (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(500, deadline - Date.now())));
    }
  }
  return null;
}

function pidFile(name) {
  return path.join(PID_DIR, `${name}.pid`);
}

function readPid(name) {
  try {
    const value = Number(fs.readFileSync(pidFile(name), 'utf8').trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function spawnService(name, definition) {
  ensureLocalDirs();
  const out = fs.openSync(path.join(LOG_DIR, `${definition.log}.log`), 'a');
  const err = fs.openSync(path.join(LOG_DIR, `${definition.log}-error.log`), 'a');
  const child = spawn(process.execPath, definition.args, {
    cwd: ROOT,
    env: { ...process.env, ...definition.env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, err]
  });
  child.unref();
  fs.writeFileSync(pidFile(name), `${child.pid}\n`);
  return child.pid;
}

function pidListeningOnPort(port) {
  if (IS_WINDOWS) {
    const result = capture('netstat.exe', ['-ano', '-p', 'tcp'], true);
    if (result.status !== 0) return null;
    for (const line of String(result.stdout || '').split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (match && Number(match[1]) === port) return Number(match[2]);
    }
    return null;
  }
  const result = capture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], true);
  if (result.status !== 0) return null;
  const pid = Number(String(result.stdout || '').trim().split(/\s+/)[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function terminatePid(pid) {
  if (!processAlive(pid)) return;
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  for (let i = 0; i < 20 && processAlive(pid); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!processAlive(pid)) return;
  if (IS_WINDOWS) {
    run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { allowFailure: true });
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

async function startOne(name) {
  const definition = SERVICES[name];
  const existing = await getJson(definition.healthUrl, 5000);
  if (existing) {
    console.log(`${name}: already running.`);
    return existing;
  }
  if (await isPortOpen(definition.port)) {
    throw new Error(`Port ${definition.port} is occupied but is not serving the expected ${name} endpoint.`);
  }
  const pid = spawnService(name, definition);
  const healthy = await waitForJson(definition.healthUrl);
  if (!healthy) {
    throw new Error(`${name} (PID ${pid}) did not become healthy within 60 seconds. See .local/logs/${definition.log}-error.log`);
  }
  console.log(`${name}: started (PID ${pid}).`);
  return healthy;
}

async function stopOne(name) {
  ensureLocalDirs();
  const definition = SERVICES[name];
  let pid = readPid(name);
  if (!processAlive(pid)) {
    const healthy = await getJson(definition.healthUrl, 3000);
    pid = healthy ? pidListeningOnPort(definition.port) : null;
  }
  if (!pid) {
    console.log(`${name}: not running.`);
    fs.rmSync(pidFile(name), { force: true });
    return;
  }
  await terminatePid(pid);
  fs.rmSync(pidFile(name), { force: true });
  console.log(`${name}: stopped.`);
}

function lanIpv4() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      if (
        address.address.startsWith('10.') ||
        address.address.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address.address)
      ) return address.address;
    }
  }
  return null;
}

async function status() {
  const bridge = await getJson(SERVICES.cleverspa.healthUrl, 5000);
  const app = await getJson(SERVICES.spararama.healthUrl, 5000);
  const telemetry = app ? await getJson('http://127.0.0.1:3000/api/telemetry/status', 5000) : null;
  const lan = lanIpv4();
  console.log(`CleverSpa adapter: ${bridge ? 'running' : 'stopped/unavailable'} (${SERVICES.cleverspa.healthUrl})`);
  console.log(`Spararama:        ${app ? 'running' : 'stopped/unavailable'} (http://127.0.0.1:3000)`);
  if (lan) console.log(`Phone UI:          http://${lan}:3000`);
  if (bridge) console.log(`Spa connection:    ${bridge.connected ? `connected via ${bridge.transport || 'adapter'}` : 'adapter running, spa unreachable'}`);
  if (telemetry) {
    console.log(`Telemetry:         ${telemetry.running ? 'running' : 'stopped'}; ${telemetry.pendingUploads ?? '?'} pending upload(s)`);
    console.log(`Firebase upload:   ${telemetry.firebaseEnabled ? 'enabled' : 'disabled'}`);
    console.log(`Local archive:     ${telemetry.localArchivePath || 'unknown'}`);
  }
}

function syncDev() {
  const dirty = capture('git', ['status', '--porcelain']);
  if (String(dirty.stdout || '').trim()) {
    throw new Error(`Working tree has uncommitted changes. Sync refused:\n${dirty.stdout}`);
  }
  run('git', ['fetch', 'origin', '--prune']);
  const branch = String(capture('git', ['branch', '--show-current']).stdout || '').trim();
  if (branch !== 'chatgpt-dev') run('git', ['switch', 'chatgpt-dev']);
  run('git', ['pull', '--ff-only', 'origin', 'chatgpt-dev']);
  run('git', ['status', '-sb']);
}

async function start() {
  const prepared = prepare();
  await startOne('cleverspa');
  // A production Express process keeps its route table in memory, while static
  // frontend assets are read from dist on each request. If prepare() rebuilt dist
  // while an older backend was still running, leaving that process alive creates
  // a split-version app: new UI + old API routes. Restart the backend whenever a
  // fresh build was produced so the frontend and API always come from one build.
  if (prepared.built && await getJson(SERVICES.spararama.healthUrl, 3000)) {
    console.log('spararama: source changed; restarting backend to match the new build.');
    await stopOne('spararama');
  }
  await startOne('spararama');
  await status();
}

async function stop() {
  await stopOne('spararama');
  await stopOne('cleverspa');
}

async function restart() {
  prepare();
  await stop();
  await startOne('cleverspa');
  await startOne('spararama');
  await status();
}

async function update() {
  syncDev();
  prepare();
  await stop();
  await startOne('cleverspa');
  await startOne('spararama');
  await status();
}

function help() {
  console.log(`Spararama local runner\n\nUsage: node scripts/local.mjs <command>\n\nCommands:\n  update   Fast-forward chatgpt-dev, install/build if needed, restart\n  sync     Fast-forward chatgpt-dev only\n  start    Start services, installing/building only when stale\n  stop     Stop local services\n  restart  Rebuild if needed and restart local services\n  status   Show app, adapter, telemetry and LAN URLs\n  help     Show this help`);
}

ensureLocalDirs();
const command = process.argv[2] || 'help';
try {
  if (command === 'update') await update();
  else if (command === 'sync') syncDev();
  else if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'restart') await restart();
  else if (command === 'status') await status();
  else if (command === 'help' || command === '--help' || command === '-h') help();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`\nSpararama local command failed: ${error?.message || error}`);
  process.exitCode = 1;
}
