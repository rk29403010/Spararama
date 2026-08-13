import 'dotenv/config';
import os from 'node:os';
import { FirebaseTelemetrySink } from '../server/telemetry/firebase-sink';
import { LocalTelemetryStore } from '../server/telemetry/local-store';

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100);
}

async function main() {
  const sink = new FirebaseTelemetrySink();
  console.log(`Firebase telemetry enabled: ${sink.config.enabled}`);
  console.log(`Project: ${sink.config.projectId}`);
  console.log(`Database: ${sink.config.databaseId}`);
  console.log(`Credential source: ${sink.config.credentialSource}`);

  const diagnosticId = safeId(`spararama-${os.hostname()}-${Date.now()}`);
  const result = await sink.verifyConnectivity(diagnosticId);
  console.log(`Diagnostic write/read/delete passed: ${result.path}`);

  if (process.argv.includes('--verify-pending')) {
    const pending = await new LocalTelemetryStore().readPending();
    if (pending.length === 0) throw new Error('There is no pending telemetry sample to verify.');
    const sampleResult = await sink.verifySampleIdempotency(pending[0]);
    console.log(`Telemetry retry/idempotency passed: ${sampleResult.path}`);
  }
}

main().catch((error: any) => {
  console.error(`Firebase diagnostic failed: ${error?.message || String(error)}`);
  process.exitCode = 1;
});
