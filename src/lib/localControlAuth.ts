import { auth } from './firebase';

let sessionRefresh: Promise<void> | null = null;

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === 'string' ? body.error : fallback;
}

async function establishLocalControlSession() {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in to control the spa from another device.');

  const idToken = await user.getIdToken();
  const response = await fetch('/api/local-auth/session', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    credentials: 'same-origin'
  });
  if (!response.ok) {
    throw new Error(await responseError(response, `Local spa sign-in failed (${response.status}).`));
  }
}

async function ensureLocalControlSession() {
  if (!sessionRefresh) {
    sessionRefresh = establishLocalControlSession().finally(() => {
      sessionRefresh = null;
    });
  }
  return sessionRefresh;
}

/**
 * State-changing local spa requests use an HttpOnly same-origin session. Direct
 * loopback requests are deliberately trusted by the backend, so they complete on
 * the first attempt and keep working as the offline/recovery path.
 */
export async function fetchLocalControl(input: RequestInfo | URL, init?: RequestInit) {
  const request = () => fetch(input, { ...init, credentials: 'same-origin' });
  let response = await request();
  if (response.status !== 401) return response;

  await ensureLocalControlSession();
  response = await request();
  return response;
}
