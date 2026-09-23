import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const webTargetDir = path.resolve(root, process.env.SPAR_BUILD_TARGET_DIR || 'dist');
const workDir = path.resolve(root, '.local');
const runtimeTargetDir = path.resolve(root, process.env.SPAR_SERVER_BUILD_TARGET_DIR || path.join('.local', 'runtime'));
const stageRoot = path.join(workDir, 'build-local-next');
const stageWebDir = path.join(stageRoot, 'web');
const stageRuntimeDir = path.join(stageRoot, 'runtime');
const previousWebDir = path.join(workDir, 'build-local-previous-web');
const previousRuntimeDir = path.join(workDir, 'build-local-previous-runtime');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function fail(message) {
  throw new Error(message);
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function restoreInterruptedSwap(targetDir, previousDir) {
  if (!fs.existsSync(targetDir) && fs.existsSync(previousDir)) {
    fs.renameSync(previousDir, targetDir);
  } else if (fs.existsSync(targetDir) && fs.existsSync(previousDir)) {
    fs.rmSync(previousDir, { recursive: true, force: true });
  }
}

function validateStage() {
  for (const relative of ['index.html', 'sw.js']) {
    const file = path.join(stageWebDir, relative);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      fail(`Staged production web build is missing ${relative}.`);
    }
  }
  for (const relative of ['server.cjs', 'server.cjs.map']) {
    const file = path.join(stageRuntimeDir, relative);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      fail(`Staged production server build is missing ${relative}.`);
    }
  }
  const worker = fs.readFileSync(path.join(stageWebDir, 'sw.js'), 'utf8');
  if (worker.includes('__SPARARAMA_BUILD_ID__')) {
    fail('Staged service worker was not assigned a build identifier.');
  }
}

function restorePrevious(targetDir, previousDir, movedCurrent) {
  if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
  if (movedCurrent && fs.existsSync(previousDir)) fs.renameSync(previousDir, targetDir);
}

fs.mkdirSync(workDir, { recursive: true });
restoreInterruptedSwap(webTargetDir, previousWebDir);
restoreInterruptedSwap(runtimeTargetDir, previousRuntimeDir);
fs.rmSync(stageRoot, { recursive: true, force: true });
fs.mkdirSync(stageRoot, { recursive: true });

run(pnpm, ['exec', 'vite', 'build'], { SPAR_BUILD_OUT_DIR: stageWebDir });
run(process.execPath, ['scripts/build-local-server.mjs'], { SPAR_SERVER_BUILD_OUT_DIR: stageRuntimeDir });
validateStage();

fs.rmSync(previousWebDir, { recursive: true, force: true });
fs.rmSync(previousRuntimeDir, { recursive: true, force: true });
let movedWeb = false;
let movedRuntime = false;
try {
  if (fs.existsSync(webTargetDir)) {
    fs.renameSync(webTargetDir, previousWebDir);
    movedWeb = true;
  }
  if (fs.existsSync(runtimeTargetDir)) {
    fs.renameSync(runtimeTargetDir, previousRuntimeDir);
    movedRuntime = true;
  }

  fs.renameSync(stageWebDir, webTargetDir);
  fs.renameSync(stageRuntimeDir, runtimeTargetDir);
} catch (error) {
  restorePrevious(webTargetDir, previousWebDir, movedWeb);
  restorePrevious(runtimeTargetDir, previousRuntimeDir, movedRuntime);
  throw error;
}

fs.rmSync(previousWebDir, { recursive: true, force: true });
fs.rmSync(previousRuntimeDir, { recursive: true, force: true });
fs.rmSync(stageRoot, { recursive: true, force: true });
console.log(
  `Validated production web build activated at ${path.relative(root, webTargetDir) || webTargetDir}; `
  + `server runtime at ${path.relative(root, runtimeTargetDir) || runtimeTargetDir}.`
);