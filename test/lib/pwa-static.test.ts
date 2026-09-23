import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('PWA manifest declares standalone raster and maskable icons', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((icon: any) => icon.sizes === '192x192' && icon.type === 'image/png'));
  assert.ok(manifest.icons.some((icon: any) => icon.sizes === '512x512' && icon.type === 'image/png'));
  assert.ok(manifest.icons.some((icon: any) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
});

test('PWA worker caches the app shell without intercepting live API data', () => {
  const worker = readFileSync('public/sw.js', 'utf8');
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /SKIP_WAITING/);
  assert.doesNotMatch(worker, /self\.skipWaiting\(\).*install/s);
});

test('PWA worker cache identity is replaced from emitted frontend content on every build', () => {
  const worker = readFileSync('public/sw.js', 'utf8');
  const viteConfig = readFileSync('vite.config.ts', 'utf8');
  const pwaClient = readFileSync('src/pwa.ts', 'utf8');

  assert.match(worker, /__SPARARAMA_BUILD_ID__/);
  assert.match(worker, /spararama-shell-\$\{BUILD_ID\}/);
  assert.match(viteConfig, /spararama-service-worker-build-id/);
  assert.match(viteConfig, /worker\.replaceAll\(SERVICE_WORKER_BUILD_PLACEHOLDER, buildId\)/);
  assert.match(pwaClient, /updateViaCache: 'none'/);
});

test('Firebase push uses a scope that cannot replace the root PWA worker', () => {
  const pushClient = readFileSync('src/lib/pushNotifications.ts', 'utf8');
  assert.match(pushClient, /scope: '\/firebase-cloud-messaging-push-scope'/);
  assert.doesNotMatch(pushClient, /firebase-messaging-sw\.js', \{ scope: '\/'/);
});