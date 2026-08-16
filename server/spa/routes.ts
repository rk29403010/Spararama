import type { Express, Request, Response } from 'express';
import type { SpaAdapter } from './types';
import type { BestEffortTemperatureResolver } from './temperature';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Spa command failed' });
    });
  };
}

export function registerSpaRoutes(app: Express, adapter: SpaAdapter, temperatureResolver?: BestEffortTemperatureResolver) {
  app.get('/api/spa/status', asyncRoute(async (_req, res) => {
    const status = await adapter.getStatus();
    if (!temperatureResolver) {
      res.json(status);
      return;
    }

    const temperature = await temperatureResolver.resolve({ liveStatus: status, allowAdapterRefresh: false });
    res.json({
      ...status,
      waterTemperatureC: temperature.valueC,
      waterTemperatureConfidence: temperature.confidence,
      waterTemperatureConfidenceScore: temperature.confidenceScore,
      waterTemperatureSource: temperature.source,
      waterTemperatureObservedAt: temperature.observedAt,
      waterTemperatureEstimated: temperature.estimated,
      waterTemperatureReason: temperature.reason
    });
  }));

  app.get('/api/spa/current-temperature', asyncRoute(async (_req, res) => {
    if (!temperatureResolver) {
      const status = await adapter.getStatus();
      res.json({
        valueC: status.waterTemperatureC,
        confidence: status.connected ? 'high' : 'low',
        confidenceScore: status.connected ? 0.9 : 0.2,
        source: status.connected ? 'live-spa' : 'last-known-water',
        observedAt: status.updatedAt,
        estimated: !status.connected,
        ageMs: Math.max(0, Date.now() - status.updatedAt),
        reason: 'Temperature resolver is not configured.'
      });
      return;
    }
    res.json(await temperatureResolver.resolve());
  }));

  app.post('/api/spa/connect', asyncRoute(async (_req, res) => {
    res.json(adapter.connect ? await adapter.connect() : await adapter.getStatus());
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
