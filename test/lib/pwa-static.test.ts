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

test('Firebase push uses a scope that cannot replace the root PWA worker', () => {
  const pushClient = readFileSync('src/lib/pushNotifications.ts', 'utf8');
  assert.match(pushClient, /scope: '\/firebase-cloud-messaging-push-scope'/);
  assert.doesNotMatch(pushClient, /firebase-messaging-sw\.js', \{ scope: '\/'/);
});
