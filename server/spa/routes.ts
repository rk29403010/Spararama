import type { Express, Request, Response } from 'express';
import type { SpaAdapter } from './types';
import type { BestEffortTemperatureResolver } from './temperature';
import type { BubbleSessionManager } from './bubbles';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Spa command failed' });
    });
  };
}

export function registerSpaRoutes(
  app: Express,
  adapter: SpaAdapter,
  temperatureResolver?: BestEffortTemperatureResolver,
  bubbles?: BubbleSessionManager
) {
  app.get('/api/spa/status', asyncRoute(async (_req, res) => {
    const status = bubbles ? await bubbles.getStatus() : await adapter.getStatus();
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
    res.json(bubbles ? await bubbles.connect() : adapter.connect ? await adapter.connect() : await adapter.getStatus());
  }));

  app.post('/api/spa/heater', asyncRoute(async (req, res) => {
    if (typeof req.body?.on !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean field: on' });
      return;
    }
    const status = await adapter.setHeater(req.body.on);
    res.json(bubbles ? bubbles.decorate(status) : status);
  }));

  app.post('/api/spa/filter', asyncRoute(async (req, res) => {
    if (typeof req.body?.on !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean field: on' });
      return;
    }
    const status = await adapter.setFilter(req.body.on);
    res.json(bubbles ? bubbles.decorate(status) : status);
  }));

  app.post('/api/spa/bubbles', asyncRoute(async (req, res) => {
    if (typeof req.body?.on !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean field: on' });
      return;
    }
    if (!bubbles) {
      res.json(await adapter.setBubbles(req.body.on));
      return;
    }
    res.json(await bubbles.setBubbles(req.body.on, {
      autoRestart: req.body?.autoRestart === true
    }));
  }));

  app.put('/api/spa/bubbles/auto-restart', asyncRoute(async (req, res) => {
    if (!bubbles) {
      res.status(409).json({ error: 'Bubble session management is not configured.' });
      return;
    }
    if (typeof req.body?.enabled !== 'boolean') {
      res.status(400).json({ error: 'Expected boolean field: enabled' });
      return;
    }
    res.json(await bubbles.setAutoRestart(req.body.enabled));
  }));

  app.post('/api/spa/target-temperature', asyncRoute(async (req, res) => {
    const celsius = Number(req.body?.celsius);
    if (!Number.isFinite(celsius)) {
      res.status(400).json({ error: 'Expected numeric field: celsius' });
      return;
    }
    const status = await adapter.setTargetTemperature(celsius);
    res.json(bubbles ? bubbles.decorate(status) : status);
  }));
}
