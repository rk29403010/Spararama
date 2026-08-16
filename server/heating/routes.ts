import type { Express, Request, Response } from 'express';
import type { HeatingScheduler } from './scheduler';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Heating schedule request failed' });
    });
  };
}

export function registerHeatingRoutes(app: Express, scheduler: HeatingScheduler) {
  app.get('/api/heating/schedules', asyncRoute(async (_req, res) => {
    res.json({ schedules: await scheduler.listSchedules() });
  }));

  app.post('/api/heating/schedules', asyncRoute(async (req, res) => {
    try {
      const schedule = await scheduler.createSchedule({
        id: typeof req.body?.id === 'string' ? req.body.id : undefined,
        startTime: Number(req.body?.startTime),
        targetTime: Number(req.body?.targetTime),
        startTemperatureC: Number(req.body?.startTemperatureC),
        targetTemperatureC: Number(req.body?.targetTemperatureC),
        autoStartPreferred: Boolean(req.body?.autoStartPreferred),
        sessionData: req.body?.sessionData && typeof req.body.sessionData === 'object' ? req.body.sessionData : undefined
      });
      res.status(201).json(schedule);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Invalid heating schedule' });
    }
  }));

  app.get('/api/heating/notifications', asyncRoute(async (_req, res) => {
    res.json({ notifications: await scheduler.listNotifications() });
  }));

  app.post('/api/heating/notifications/:id/delivered', asyncRoute(async (req, res) => {
    res.json(await scheduler.markNotificationDelivered(req.params.id));
  }));

  app.post('/api/heating/schedules/:id/confirm-manual', asyncRoute(async (req, res) => {
    const supplied = req.body?.temperatureC;
    const temperatureC = supplied === undefined || supplied === null || supplied === '' ? undefined : Number(supplied);
    if (temperatureC !== undefined && !Number.isFinite(temperatureC)) {
      res.status(400).json({ error: 'temperatureC must be numeric when supplied.' });
      return;
    }
    res.json(await scheduler.confirmManualStart(req.params.id, temperatureC));
  }));
}
