import { spawnSync } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(
  pnpm,
  ['exec', 'vite', 'build', '--outDir', 'dist/cloud-web', '--emptyOutDir'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_SPARARAMA_RUNTIME: 'cloud'
    },
    // Windows invokes .cmd shims through cmd.exe; direct spawning produces EINVAL.
    shell: process.platform === 'win32',
    stdio: 'inherit'
  }
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
