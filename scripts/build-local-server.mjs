import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const outDir = path.resolve(process.env.SPAR_SERVER_BUILD_OUT_DIR || '.local/runtime');
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: ['server.ts'],
  outfile: path.join(outDir, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
});