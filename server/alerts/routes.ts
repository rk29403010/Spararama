import type { Express, Request, Response } from 'express';
import type { LocalControlSecurity } from '../security/local-control';
import type { AlexaAlertDispatcher } from './alexa-dispatcher';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Alexa alert request failed' });
    });
  };
}

export function registerAlertRoutes(
  app: Express,
  dispatcher: AlexaAlertDispatcher,
  security: LocalControlSecurity
) {
  const requireOwner = security.requireBearerRole(['owner']);

  app.get('/api/alerts/alexa', requireOwner, asyncRoute(async (_req, res) => {
    res.json(await dispatcher.status());
  }));

  app.put('/api/alerts/alexa', requireOwner, asyncRoute(async (req, res) => {
    res.json(await dispatcher.configure({
      enabled: req.body?.enabled === undefined ? undefined : Boolean(req.body.enabled),
      token: typeof req.body?.token === 'string' ? req.body.token.slice(0, 500) : undefined,
      device: typeof req.body?.device === 'string' ? req.body.device.slice(0, 200) : undefined,
      chime: typeof req.body?.chime === 'string' ? req.body.chime.slice(0, 200) : undefined
    }));
  }));

  app.post('/api/alerts/alexa/speakers', requireOwner, asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = typeof req.body?.token === 'string' ? req.body.token.slice(0, 500) : undefined;
    res.json({ speakers: await dispatcher.listSpeakers(token) });
  }));

  app.post('/api/alerts/alexa/test', requireOwner, asyncRoute(async (_req, res) => {
    res.json(await dispatcher.test());
  }));
}
