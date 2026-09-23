import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { productionBuildKey } from '../../scripts/production-build-key.mjs';

test('production build key changes when effective VITE environment changes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-build-key-'));
  const variable = 'VITE_SPARARAMA_TEST_FINGERPRINT';
  const previous = process.env[variable];
  delete process.env[variable];
  try {
    await fs.writeFile(path.join(dir, '.env.production'), `${variable}=one\nSERVER_ONLY=alpha\n`);
    const first = productionBuildKey('abc123', dir);

    await fs.writeFile(path.join(dir, '.env.production'), `${variable}=two\nSERVER_ONLY=alpha\n`);
    const second = productionBuildKey('abc123', dir);
    assert.notEqual(second, first);

    await fs.writeFile(path.join(dir, '.env.production'), `${variable}=two\nSERVER_ONLY=beta\n`);
    const serverOnlyChange = productionBuildKey('abc123', dir);
    assert.equal(serverOnlyChange, second);

    process.env[variable] = 'exported-value';
    const exported = productionBuildKey('abc123', dir);
    assert.notEqual(exported, second);
  } finally {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
