import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Express, Request, Response } from 'express';
import type { AlexaAlertDispatcher } from './alexa-dispatcher';

const DEFAULT_PROJECT_ID = 'microprojects-481213';
const SETTINGS_AUTH_APP_NAME = 'spararama-alert-settings-auth';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Alexa alert request failed' });
    });
  };
}

function adminAuth() {
  const projectId = process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const app = getApps().find(candidate => candidate.name === SETTINGS_AUTH_APP_NAME)
    || initializeApp({ credential: applicationDefault(), projectId }, SETTINGS_AUTH_APP_NAME);
  return getAuth(app);
}

async function requireSettingsUser(req: Request, res: Response) {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Sign in to change alert credentials.' });
    return false;
  }

  try {
    const decoded = await adminAuth().verifyIdToken(match[1]);
    const allowedUid = String(process.env.SPARARAMA_ADMIN_UID || '').trim();
    const allowedEmails = String(process.env.SPARARAMA_ADMIN_EMAILS || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);

    if (allowedUid && decoded.uid !== allowedUid) {
      res.status(403).json({ error: 'This account is not allowed to change alert credentials.' });
      return false;
    }
    if (allowedEmails.length && !allowedEmails.includes(String(decoded.email || '').toLowerCase())) {
      res.status(403).json({ error: 'This account is not allowed to change alert credentials.' });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ error: 'Your sign-in could not be verified. Sign in again and retry.' });
    return false;
  }
}

export function registerAlertRoutes(app: Express, dispatcher: AlexaAlertDispatcher) {
  app.get('/api/alerts/alexa', asyncRoute(async (req, res) => {
    if (!(await requireSettingsUser(req, res))) return;
    res.json(await dispatcher.status());
  }));

  app.put('/api/alerts/alexa', asyncRoute(async (req, res) => {
    if (!(await requireSettingsUser(req, res))) return;
    res.json(await dispatcher.configure({
      enabled: req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled),
      token: typeof req.body?.token === 'string' ? req.body.token.slice(0, 500) : undefined,
      device: typeof req.body?.device === 'string' ? req.body.device.slice(0, 200) : undefined,
      chime: typeof req.body?.chime === 'string' ? req.body.chime.slice(0, 200) : undefined
    }));
  }));

  app.post('/api/alerts/alexa/test', asyncRoute(async (req, res) => {
    if (!(await requireSettingsUser(req, res))) return;
    res.json(await dispatcher.test());
  }));
}
