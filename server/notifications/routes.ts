import type { Express, Request, Response } from 'express';
import type { LocalControlSecurity } from '../security/local-control';
import type { NotificationService } from './service';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Notification request failed.' });
    });
  };
}

function signedInUid(res: Response) {
  return String(res.locals.localControlUid || '').trim();
}

export function registerNotificationRoutes(
  app: Express,
  notifications: NotificationService,
  security: LocalControlSecurity
) {
  app.get('/api/notifications', asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ notifications: await notifications.listActive() });
  }));

  app.get('/api/notifications/recent', security.protectAuthenticatedOperation, asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const requested = Number(req.query.limit || 100);
    const limit = Number.isFinite(requested) ? requested : 100;
    res.json({ notifications: await notifications.listRecent(limit) });
  }));

  app.post(
    '/api/notifications/:id/acknowledge',
    security.protectAuthenticatedOperation,
    asyncRoute(async (req, res) => {
      res.json(await notifications.acknowledge(req.params.id, signedInUid(res) || undefined));
    })
  );

  app.get('/api/notification-preferences/me', security.protectAuthenticatedOperation, asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = signedInUid(res);
    if (!uid) {
      res.status(409).json({ error: 'Sign in to manage personal notification preferences.' });
      return;
    }
    res.json(await notifications.preferences.getUser(uid));
  }));

  app.patch('/api/notification-preferences/me', security.protectAuthenticatedOperation, asyncRoute(async (req, res) => {
    const uid = signedInUid(res);
    if (!uid) {
      res.status(409).json({ error: 'Sign in to manage personal notification preferences.' });
      return;
    }
    res.json(await notifications.preferences.updateUser(uid, req.body?.push));
  }));

  const requireAdmin = security.requireBearerPermission('user_admin');

  app.get('/api/notification-preferences/shared', requireAdmin, asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await notifications.preferences.getShared());
  }));

  app.patch('/api/notification-preferences/shared', requireAdmin, asyncRoute(async (req, res) => {
    res.json(await notifications.preferences.updateShared(req.body?.alexa));
  }));
}
