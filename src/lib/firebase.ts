import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';

const firebaseConfig = {
  projectId: "microprojects-481213",
  appId: "1:917911030888:web:c474b419d5a03c0066bfdd",
  // @ts-ignore
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "microprojects-481213.firebaseapp.com",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, "ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65");
export const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, provider);
  } catch (err: any) {
    console.error("Sign-in failed", err);
  }
}

export function signOutUser() {
  return signOut(auth);
}

export function subscribeToAuthChanges(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
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
    const user = auth.currentUser;
    if (!user) {
      throw new Error("You must be signed in to migrate logs.");
    }

    const q = query(collection(db, 'logs'), limit(500));
    const snap = await getDocs(q);

    if (snap.empty) {
      return { success: true, count: 0, message: "No old logs found to migrate." };
    }

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
