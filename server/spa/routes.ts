import type { Express, Request, Response } from 'express';
import type { SpaAdapter } from './types';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Spa command failed' });
    });
  };
}

export function registerSpaRoutes(app: Express, adapter: SpaAdapter) {
  app.get('/api/spa/status', asyncRoute(async (_req, res) => {
    res.json(await adapter.getStatus());
  }));

  app.post('/api/spa/heater', asyncRoute(async (req, res) => {
    if (typeof req.body?.on !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean field: on' });
      return;
    }
    res.json(await adapter.setHeater(req.body.on));
  }));

  app.post('/api/spa/filter', asyncRoute(async (req, res) => {
    if (typeof req.body?.on !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean field: on' });
      return;
    }
    res.json(await adapter.setFilter(req.body.on));
  }));

  app.post('/api/spa/bubbles', asyncRoute(async (req, res) => {
    if (typeof req.body?.on !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean field: on' });
      return;
    }
    res.json(await adapter.setBubbles(req.body.on));
  }));

  app.post('/api/spa/target-temperature', asyncRoute(async (req, res) => {
    const celsius = Number(req.body?.celsius);
    if (!Number.isFinite(celsius)) {
      res.status(400).json({ error: 'Expected numeric field: celsius' });
      return;
    }
    res.json(await adapter.setTargetTemperature(celsius));
  }));
}
