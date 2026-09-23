import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';

const SERVICE_WORKER_BUILD_PLACEHOLDER = '__SPARARAMA_BUILD_ID__';

function listBuildFiles(root: string, current = root): string[] {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) return listBuildFiles(root, absolute);
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
    return relative === 'sw.js' ? [] : [relative];
  });
}

function versionServiceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'spararama-service-worker-build-id',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle() {
      const outDir = path.resolve(config.root, config.build.outDir);
      const workerPath = path.join(outDir, 'sw.js');
      if (!fs.existsSync(workerPath)) throw new Error(`Built service worker is missing: ${workerPath}`);

      const hash = crypto.createHash('sha256');
      for (const relative of listBuildFiles(outDir).sort()) {
        hash.update(relative);
        hash.update('\0');
        hash.update(fs.readFileSync(path.join(outDir, relative)));
        hash.update('\0');
      }
      const buildId = hash.digest('hex').slice(0, 20);
      const worker = fs.readFileSync(workerPath, 'utf8');
      if (!worker.includes(SERVICE_WORKER_BUILD_PLACEHOLDER)) {
        throw new Error('Service worker build-id placeholder is missing.');
      }
      fs.writeFileSync(
        workerPath,
        worker.replaceAll(SERVICE_WORKER_BUILD_PLACEHOLDER, buildId),
        'utf8'
      );
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), versionServiceWorker()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: process.env.SPAR_BUILD_OUT_DIR || 'dist',
      emptyOutDir: true
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});