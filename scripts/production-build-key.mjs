import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

export function effectiveViteEnvironment(cwd = process.cwd()) {
  const loaded = loadEnv('production', cwd, 'VITE_');
  const effective = { ...loaded };
  // Vite gives variables already present in process.env highest priority. Make
  // that precedence explicit here so the fingerprint follows the actual build.
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('VITE_') && value !== undefined) effective[key] = value;
  }
  return Object.fromEntries(
    Object.entries(effective)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

export function productionBuildKey(commit, cwd = process.cwd()) {
  const normalizedCommit = String(commit || '').trim();
  if (!normalizedCommit) throw new Error('A Git commit is required for the production build key.');
  const serialized = JSON.stringify(effectiveViteEnvironment(cwd));
  const environmentHash = crypto.createHash('sha256').update(serialized).digest('hex');
  return `${normalizedCommit}:${environmentHash}`;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    process.stdout.write(`${productionBuildKey(process.argv[2])}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
