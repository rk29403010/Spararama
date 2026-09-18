import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { resolveFirebaseAdminTarget } from '../../firebase/admin-config';

const CLOUD_APP_NAME = 'spararama-cloud-control';

export function getCloudAdminApp() {
  const target = resolveFirebaseAdminTarget();
  return getApps().find(candidate => candidate.name === CLOUD_APP_NAME)
    || initializeApp(
      { credential: applicationDefault(), projectId: target.projectId },
      CLOUD_APP_NAME
    );
}

export function getCloudFirestore() {
  const target = resolveFirebaseAdminTarget();
  return getFirestore(getCloudAdminApp(), target.databaseId);
}

export function getCloudAuth() {
  return getAuth(getCloudAdminApp());
}
