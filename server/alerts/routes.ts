import type { Express, Request, Response } from 'express';
import type { AlexaAlertDispatcher } from './alexa-dispatcher';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Alexa alert request failed' });
    });
  };
}

export function registerAlertRoutes(app: Express, dispatcher: AlexaAlertDispatcher) {
  app.get('/api/alerts/alexa', (_req, res) => {
    res.json(dispatcher.status());
  });

  app.post('/api/alerts/alexa/test', asyncRoute(async (_req, res) => {
    res.json(await dispatcher.test());
  }));
}
