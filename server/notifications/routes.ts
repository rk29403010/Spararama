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

export function registerNotificationRoutes(
  app: Express,
  notifications: NotificationService,
  security: LocalControlSecurity
) {
  app.get('/api/notifications', asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ notifications: await notifications.listActive() });
  }));

  app.post(
    '/api/notifications/:id/acknowledge',
    security.protectAuthenticatedOperation,
    asyncRoute(async (req, res) => {
      res.json(await notifications.acknowledge(req.params.id, String(res.locals.localControlUid || '') || undefined));
    })
  );
}
