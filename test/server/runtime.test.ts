import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { MockSpaAdapter } from '../../server/spa/mock';

test('runtime counters accumulate while equipment is on', async () => {
  let now = 1_000_000;
  const spa = new MockSpaAdapter(() => now);

  await spa.setFilter(true);
  now += 3_600_000;
  const afterFilterHour = await spa.getStatus();
  assert.equal(afterFilterHour.filterRuntimeSeconds, 3600);
  assert.equal(afterFilterHour.heaterRuntimeSeconds, 0);

  await spa.setHeater(true);
  now += 1_800_000;
  const afterHeating = await spa.getStatus();
  assert.equal(afterHeating.filterRuntimeSeconds, 5400);
  assert.equal(afterHeating.heaterRuntimeSeconds, 1800);
});

test('main server wires secured background push registration to the same heating push service', async () => {
  const source = await fs.readFile(path.join(process.cwd(), 'server.ts'), 'utf8');
  assert.match(source, /const localControlSecurity = registerLocalControlSecurity\(app\)/);
  assert.match(source, /const pushService = new PushService\(\)/);
  assert.match(source, /new HeatingScheduler\(spaAdapter, new HeatingStore\(\), pushService\)/);
  assert.match(source, /registerPushRoutes\(app, pushService, localControlSecurity\)/);
});

test('production Node runtime is built outside the public dist directory', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
  const serverBuild = await fs.readFile(path.join(process.cwd(), 'scripts/build-local-server.mjs'), 'utf8');
  const localRunner = await fs.readFile(path.join(process.cwd(), 'scripts/local.mjs'), 'utf8');
  const termuxRunner = await fs.readFile(path.join(process.cwd(), 'scripts/termux/spar'), 'utf8');

  assert.equal(packageJson.scripts.start, 'node .local/runtime/server.cjs');
  assert.match(serverBuild, /SPAR_SERVER_BUILD_OUT_DIR \|\| '\.local\/runtime'/);
  assert.match(localRunner, /args: \['\.local\/runtime\/server\.cjs'\]/);
  assert.match(termuxRunner, /\.local\/runtime\/server\.cjs/);
  assert.doesNotMatch(packageJson.scripts.start, /dist\/server\.cjs/);
});