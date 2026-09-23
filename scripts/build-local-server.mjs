import path from 'node:path';
import { build } from 'esbuild';

const outDir = process.env.SPAR_BUILD_OUT_DIR || 'dist';

await build({
  entryPoints: ['server.ts'],
  outfile: path.join(outDir, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
});