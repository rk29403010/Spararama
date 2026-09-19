import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import { getCloudFirestore } from '../server/remote/cloud/firebase-admin';
import type { InstallationRole } from '../server/remote/cloud/service';

function usage(): never {
  console.error(`Usage:
  pnpm remote:membership -- bootstrap <installation-id> <owner-uid> [name]
  pnpm remote:membership -- add <installation-id> <uid> <owner|member|viewer>
  pnpm remote:membership -- remove <installation-id> <uid>`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const [action, installationId, uid, extra] = args;
if (!action || !installationId || !uid) usage();
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(installationId)) {
  throw new Error('Installation ID must be 2-80 characters using letters, numbers, _ or -.');
}

const db = getCloudFirestore();
const installationRef = db.collection('installations').doc(installationId);
const memberRef = installationRef.collection('members').doc(uid);

if (action === 'bootstrap') {
  const name = String(extra || installationId).trim().slice(0, 120) || installationId;
  const existing = await installationRef.get();
  await installationRef.set({
    schemaVersion: 1,
    name,
    updatedAt: FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
  }, { merge: true });
  await memberRef.set({
    uid,
    role: 'owner',
    addedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`Installation ${installationId} is ready; ${uid} is an owner.`);
} else if (action === 'add') {
  const role = extra as InstallationRole;
  if (!['owner', 'member', 'viewer'].includes(String(role))) usage();
  if (!(await installationRef.get()).exists) {
    throw new Error(`Installation ${installationId} does not exist. Bootstrap it first.`);
  }
  await memberRef.set({
    uid,
    role,
    addedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`${uid} now has ${role} access to ${installationId}.`);
} else if (action === 'remove') {
  await memberRef.delete();
  console.log(`Removed ${uid} from ${installationId}.`);
} else {
  usage();
}
