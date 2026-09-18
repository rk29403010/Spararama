import 'dotenv/config';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { resolveFirebaseAdminTarget } from '../server/firebase/admin-config';

const installationId = String(process.env.REMOTE_INSTALLATION_ID || '').trim();
if (!installationId) {
  throw new Error('REMOTE_INSTALLATION_ID is required for the remote diagnostic.');
}

const target = resolveFirebaseAdminTarget();
const appName = 'spararama-remote-diagnostic';
const app = getApps().find(candidate => candidate.name === appName)
  || initializeApp({ credential: applicationDefault(), projectId: target.projectId }, appName);
const db = getFirestore(app, target.databaseId);

const commandId = `diagnostic-${crypto.randomUUID()}`;
const now = Date.now();
const ref = db
  .collection('installations')
  .doc(installationId)
  .collection('commands')
  .doc(commandId);

console.log(`Remote diagnostic installation: ${installationId}`);
console.log(`Firebase project/database: ${target.projectId} / ${target.databaseId}`);
console.log(`Credential source: ${target.credentialSource}`);
console.log(`Queueing read-only command: ${commandId}`);

await ref.set({
  version: 1,
  commandId,
  installationId,
  type: 'readStatus',
  payload: {},
  createdAt: now,
  expiresAt: now + 30_000,
  requestedBy: { kind: 'system', id: 'remote-diagnostic' },
  status: 'queued',
  createdAtServer: FieldValue.serverTimestamp()
}, { merge: false });

let terminal: any;
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 500));
  const snapshot = await ref.get();
  const data = snapshot.data();
  const status = String(data?.status || '');
  if (['succeeded', 'failed', 'expired', 'rejected'].includes(status)) {
    terminal = data;
    break;
  }
}

if (!terminal) {
  console.error('Timed out waiting for the local Spararama node to handle the diagnostic command.');
  console.error('Check REMOTE_TRANSPORT=firebase, REMOTE_INSTALLATION_ID, Firebase credentials, and /api/health remote status on the local node.');
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(terminal.result || terminal, null, 2));
  if (terminal.status !== 'succeeded') process.exitCode = 1;
}

if (String(process.env.REMOTE_DIAGNOSTIC_KEEP || '').toLowerCase() !== 'true') {
  try {
    await ref.delete();
  } catch (error) {
    console.warn(`Could not remove diagnostic command: ${error instanceof Error ? error.message : String(error)}`);
  }
}
