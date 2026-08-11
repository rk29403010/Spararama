import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  projectId: "microprojects-481213",
  appId: "1:917911030888:web:c474b419d5a03c0066bfdd",
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "microprojects-481213.firebaseapp.com",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, "ai-studio-hottubmonitor-c4b572e9-4270-488c-b8d2-306ccf453f65");
export const auth = getAuth(app);

// Authenticate anonymously (swallow error if not enabled)
signInAnonymously(auth).catch(() => {});

export async function logEvent(type: 'temperature_input' | 'chemical_dose' | 'heating_calculated' | 'manual_log' | 'heating_action', data: any) {
  try {
    await addDoc(collection(db, 'logs'), {
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
    const q = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Failed to fetch logs", err);
    return [];
  }
}
