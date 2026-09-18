import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_FIREBASE_PROJECT_ID = 'microprojects-481213';
export const DEFAULT_FIRESTORE_DATABASE_ID = 'ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65';

export interface FirebaseAdminTarget {
  projectId: string;
  databaseId: string;
  credentialSource: string;
}

export function firebaseCredentialSourceDescription() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      ? 'GOOGLE_APPLICATION_CREDENTIALS (file present)'
      : 'GOOGLE_APPLICATION_CREDENTIALS (file missing)';
  }

  const appData = process.env.APPDATA;
  const cloudSdkConfig = process.env.CLOUDSDK_CONFIG;
  const wellKnownPath = cloudSdkConfig
    ? path.join(cloudSdkConfig, 'application_default_credentials.json')
    : appData
      ? path.join(appData, 'gcloud', 'application_default_credentials.json')
      : null;

  if (wellKnownPath && fs.existsSync(wellKnownPath)) {
    return 'Google Cloud SDK application-default credentials';
  }

  return 'Application Default Credentials (environment or metadata; no local file detected)';
}

export function resolveFirebaseAdminTarget(): FirebaseAdminTarget {
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID,
    databaseId: process.env.FIRESTORE_DATABASE_ID || DEFAULT_FIRESTORE_DATABASE_ID,
    credentialSource: firebaseCredentialSourceDescription()
  };
}
