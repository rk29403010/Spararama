import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { assessChemistry } from '../domain/chemistry';
import { createDefaultDomainState } from '../domain/defaults';
import { correctLegacySevenWayReadings, SEVEN_WAY_SCALE_REVISION } from '../domain/stripScales';

const firebaseConfig = {
  projectId: "microprojects-481213",
  appId: "1:917911030888:web:c474b419d5a03c0066bfdd",
  messagingSenderId: "917911030888",
  // @ts-ignore
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "microprojects-481213.firebaseapp.com",
};

const apiKey = String(firebaseConfig.apiKey || '').trim();
export const isFirebaseConfigured = Boolean(apiKey && apiKey !== 'YOUR_FIREBASE_API_KEY');

// Firebase is optional for a local-only installation. Do not initialise Auth or
// Firestore until a real browser API key has been provided; the SDK otherwise
// throws during module evaluation and prevents the whole UI from loading.
export const firebaseApp = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const db = firebaseApp ? getFirestore(firebaseApp, "ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65") : null;
export const auth = firebaseApp ? getAuth(firebaseApp) : null;

const googleClientId = '917911030888-umuoc3r4l62j26naqdj474rmjtijd4kn.apps.googleusercontent.com';
let googleIdentityPromise: Promise<any> | null = null;
let googleIdentityInitialized = false;
const sevenWayCorrectionInFlight = new Set<string>();

function loadGoogleIdentity() {
  if ((window as any).google?.accounts?.id) return Promise.resolve((window as any).google);
  if (googleIdentityPromise) return googleIdentityPromise;

  googleIdentityPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve((window as any).google);
    script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
    document.head.appendChild(script);
  });
  return googleIdentityPromise;
}

export async function renderGoogleSignInButton(container: HTMLElement) {
  if (!auth) throw new Error('Firebase is not configured on this device.');
  const google = await loadGoogleIdentity();

  if (!googleIdentityInitialized) {
    google.accounts.id.initialize({
      client_id: googleClientId,
      use_fedcm_for_prompt: false,
      use_fedcm_for_button: false,
      callback: async (response: { credential?: string }) => {
        if (!response.credential || !auth) return;
        try {
          const credential = GoogleAuthProvider.credential(response.credential);
          await signInWithCredential(auth, credential);
        } catch (error) {
          console.error('Google credential sign-in failed', error);
        }
      }
    });
    googleIdentityInitialized = true;
  }

  container.replaceChildren();
  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'medium',
    text: 'signin_with',
    shape: 'pill'
  });
}

export function signOutUser() {
  if (!auth) return Promise.resolve();
  return signOut(auth);
}

export interface SevenWayCorrectionSummary {
  scanned: number;
  auditedRecords: number;
  originalScaleRecords: number;
  currentScaleRecords: number;
  badScaleRecords: number;
  ambiguousRecords: number;
  timestampInferredRecords: number;
  correctedRecords: number;
  correctedReadings: number;
  unresolvedReadings: number;
  readyToNotReady: number;
  notReadyToReady: number;
}

/**
 * One-off/idempotent repair and safety re-audit of 7-in-1 water-test logs.
 *
 * The first visual-entry version (19/20 Aug) had the bottle's numeric values
 * right but omitted bromine. Commit 4039488 on 21 Aug introduced a different,
 * incorrect scale. Bad-layout readings are therefore remapped by the selected
 * swatch position. Original-layout readings are left numerically unchanged.
 *
 * Every historical 7-in-1 assessment is then re-run through the current
 * chemistry rules, including the free/total chlorine consistency and combined
 * chlorine safety checks. This is deliberate: correcting the stored number but
 * leaving stale "ready" advice would not be a complete repair.
 */
export async function correctSevenWayWaterTestLogs(userOverride?: User): Promise<SevenWayCorrectionSummary> {
  const summary: SevenWayCorrectionSummary = {
    scanned: 0,
    auditedRecords: 0,
    originalScaleRecords: 0,
    currentScaleRecords: 0,
    badScaleRecords: 0,
    ambiguousRecords: 0,
    timestampInferredRecords: 0,
    correctedRecords: 0,
    correctedReadings: 0,
    unresolvedReadings: 0,
    readyToNotReady: 0,
    notReadyToReady: 0
  };

  if (!auth || !db) return summary;
  const user = userOverride ?? auth.currentUser;
  if (!user || sevenWayCorrectionInFlight.has(user.uid)) return summary;

  const firestore = db;
  sevenWayCorrectionInFlight.add(user.uid);
  try {
    const snap = await getDocs(collection(firestore, 'users', user.uid, 'logs'));
    const defaultDomain = createDefaultDomainState();
    const defaultWaterBody = defaultDomain.waterBodies.find(item => item.id === defaultDomain.activeWaterBodyId) ?? defaultDomain.waterBodies[0];
    const pending: Array<{ ref: (typeof snap.docs)[number]['ref']; data: any }> = [];

    for (const logDoc of snap.docs) {
      const log = logDoc.data() as any;
      if (log?.type !== 'water_test' || log?.data?.testMethodId !== 'current-7-way') continue;
      summary.scanned++;

      const payload = log.data;
      if (!Array.isArray(payload.readings) || payload.scaleAuditRevision === SEVEN_WAY_SCALE_REVISION) continue;

      const correction = correctLegacySevenWayReadings(payload.readings, { recordedAt: payload.timestamp });
      if (correction.inferredFromTimestamp) summary.timestampInferredRecords++;

      if (correction.layout === 'current') summary.currentScaleRecords++;
      else if (correction.layout === 'original') summary.originalScaleRecords++;
      else if (correction.layout === 'bad') summary.badScaleRecords++;
      else summary.ambiguousRecords++;

      const waterBody = defaultDomain.waterBodies.find(item => item.id === payload.waterBodyId) ?? defaultWaterBody;
      if (!waterBody) continue;

      const unresolved = correction.layout === 'ambiguous' ? correction.unresolvedCount : correction.unresolvedCount;
      const effectiveReadings = correction.readings;
      let newAssessment: any = assessChemistry(waterBody, defaultDomain.products, effectiveReadings);

      if (unresolved > 0 || correction.layout === 'ambiguous') {
        newAssessment = {
          ...newAssessment,
          nextAction: {
            kind: 'retest',
            measurements: effectiveReadings.map(reading => reading.measurement),
            reason: 'Historical 7-in-1 record cannot be mapped unambiguously to the verified bottle scale. Treat this old result as unverified.'
          }
        };
      }

      const oldReady = payload.assessment?.nextAction?.kind === 'none';
      const newReady = newAssessment?.nextAction?.kind === 'none';
      if (oldReady && !newReady) summary.readyToNotReady++;
      if (!oldReady && newReady) summary.notReadyToReady++;

      summary.auditedRecords++;
      summary.correctedReadings += correction.correctedCount;
      summary.unresolvedReadings += unresolved;
      if (correction.correctedCount > 0) summary.correctedRecords++;

      const fullyVerified = correction.layout !== 'ambiguous' && unresolved === 0;
      pending.push({
        ref: logDoc.ref,
        data: {
          ...payload,
          readings: effectiveReadings,
          assessment: newAssessment,
          ...(fullyVerified ? { scaleRevision: SEVEN_WAY_SCALE_REVISION } : {}),
          scaleAuditRevision: SEVEN_WAY_SCALE_REVISION,
          scaleCorrection: {
            auditedAt: Date.now(),
            correctedReadings: correction.correctedCount,
            unresolvedReadings: unresolved,
            sourceLayout: correction.layout,
            inferredFromTimestamp: correction.inferredFromTimestamp,
            method: correction.correctedCount > 0 ? 'swatch_position' : 'assessment_reaudit'
          }
        }
      });
    }

    for (let start = 0; start < pending.length; start += 400) {
      const batch = writeBatch(firestore);
      for (const item of pending.slice(start, start + 400)) {
        batch.update(item.ref, { data: item.data });
      }
      await batch.commit();
    }

    if (summary.auditedRecords > 0) {
      await addDoc(collection(firestore, 'users', user.uid, 'logs'), {
        type: 'maintenance',
        data: {
          action: 'seven_way_scale_correction',
          scaleRevision: SEVEN_WAY_SCALE_REVISION,
          ...summary,
          note: 'Historical 7-in-1 readings were version-classified, bad-layout values were corrected by swatch position, and every record was re-assessed with current chlorine safety checks.'
        },
        timestamp: serverTimestamp()
      });
      console.info('7-in-1 Firestore scale correction and safety audit complete', summary);
    }

    return summary;
  } catch (error) {
    console.error('7-in-1 Firestore scale correction failed', error);
    throw error;
  } finally {
    sevenWayCorrectionInFlight.delete(user.uid);
  }
}

export function subscribeToAuthChanges(callback: (user: User | null) => void) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, user => {
    callback(user);
    if (user) {
      void correctSevenWayWaterTestLogs(user).catch(() => {
        // The app remains usable if a one-off history repair cannot complete;
        // the next authenticated launch will retry records not yet audit-stamped.
      });
    }
  });
}

export type LogEventType =
  | 'temperature_input'
  | 'water_test'
  | 'chemical_dose'
  | 'heating_calculated'
  | 'manual_log'
  | 'heating_action'
  | 'maintenance';

export async function logEvent(type: LogEventType, data: any) {
  try {
    if (!auth || !db) return;
    const user = auth.currentUser;
    if (!user) {
      console.warn("User is not signed in. Log event skipped.");
      return;
    }
    await addDoc(collection(db, 'users', user.uid, 'logs'), {
      type,
      data,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.error("Failed to log event", err);
  }
}

export async function getLogs(max = 50) {
  try {
    if (!auth || !db) return [];
    const user = auth.currentUser;
    if (!user) {
      console.warn("User is not signed in. Returning empty logs.");
      return [];
    }
    const q = query(collection(db, 'users', user.uid, 'logs'), orderBy('timestamp', 'desc'), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Failed to fetch logs", err);
    return [];
  }
}

// Temporary one-off migration utility. Remove this and the corresponding legacy
// Firestore read rule once the old global logs have been copied successfully.
export async function migrateOldLogs() {
  try {
    if (!auth || !db) {
      return { success: false, count: 0, message: 'Firebase is not configured on this device.' };
    }
    const user = auth.currentUser;
    if (!user) {
      throw new Error("You must be signed in to migrate logs.");
    }

    const q = query(collection(db, 'logs'), limit(500));
    const snap = await getDocs(q);
    if (snap.empty) return { success: true, count: 0, message: "No old logs found to migrate." };

    const batch = writeBatch(db);
    let count = 0;
    snap.forEach((oldDoc) => {
      const data = oldDoc.data();
      const newRef = doc(collection(db, 'users', user.uid, 'logs'));
      batch.set(newRef, data);
      count++;
    });

    await batch.commit();
    return { success: true, count, message: `Successfully copied ${count} logs to your account. You may want to delete the old public logs manually.` };
  } catch (err: any) {
    console.error("Migration failed", err);
    return { success: false, count: 0, message: err.message };
  }
}
