import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const targetDir = path.resolve(root, process.env.SPAR_BUILD_TARGET_DIR || 'dist');
const workDir = path.resolve(root, '.local');
const stageDir = path.join(workDir, 'build-local-next');
const previousDir = path.join(workDir, 'build-local-previous');
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

function restoreInterruptedSwap() {
  if (!fs.existsSync(targetDir) && fs.existsSync(previousDir)) {
    fs.renameSync(previousDir, targetDir);
  } else if (fs.existsSync(targetDir) && fs.existsSync(previousDir)) {
    fs.rmSync(previousDir, { recursive: true, force: true });
  }
}

function validateStage() {
  for (const relative of ['index.html', 'server.cjs', 'sw.js']) {
    const file = path.join(stageDir, relative);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      fail(`Staged production build is missing ${relative}.`);
    }
  }
  const worker = fs.readFileSync(path.join(stageDir, 'sw.js'), 'utf8');
  if (worker.includes('__SPARARAMA_BUILD_ID__')) {
    fail('Staged service worker was not assigned a build identifier.');
  }
}

fs.mkdirSync(workDir, { recursive: true });
restoreInterruptedSwap();
fs.rmSync(stageDir, { recursive: true, force: true });

run(pnpm, ['exec', 'vite', 'build'], { SPAR_BUILD_OUT_DIR: stageDir });
run(process.execPath, ['scripts/build-local-server.mjs'], { SPAR_BUILD_OUT_DIR: stageDir });
validateStage();

fs.rmSync(previousDir, { recursive: true, force: true });
let movedCurrent = false;
try {
  if (fs.existsSync(targetDir)) {
    fs.renameSync(targetDir, previousDir);
    movedCurrent = true;
  }
  fs.renameSync(stageDir, targetDir);
} catch (error) {
  if (!fs.existsSync(targetDir) && movedCurrent && fs.existsSync(previousDir)) {
    fs.renameSync(previousDir, targetDir);
  }
  throw error;
}

fs.rmSync(previousDir, { recursive: true, force: true });
console.log(`Validated production build activated at ${path.relative(root, targetDir) || targetDir}.`);