import type { Express, Request, Response } from 'express';
import type { LocalControlSecurity } from '../security/local-control';
import type { SpaHealthMonitor } from './spa-health-monitor';
import type { SpaHealthSettingsStore } from './settings';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      const status = Number(error?.statusCode || 400);
      res.status(status >= 400 && status <= 599 ? status : 400).json({
        error: error?.message || 'Spa health settings request failed.'
      });
    });
  };
}

export function registerSpaHealthRoutes(
  app: Express,
  monitor: SpaHealthMonitor,
  settings: SpaHealthSettingsStore,
  security: LocalControlSecurity
) {
  const requireMember = security.requireBearerRole(['owner', 'member', 'viewer']);
  const requireSpaControl = security.requireBearerPermission('spa_control');

  app.get('/api/spa-health/settings', requireMember, asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ...(await settings.get()),
      health: monitor.getStatus()
    });
  }));

  app.patch('/api/spa-health/settings', requireSpaControl, asyncRoute(async (req, res) => {
    const paused = req.body?.offlineAlertsPaused;
    if (typeof paused !== 'boolean') {
      res.status(400).json({ error: 'offlineAlertsPaused must be true or false.' });
      return;
    }
    const until = req.body?.offlineAlertsPausedUntil;
    if (until !== undefined && until !== null && !Number.isFinite(Number(until))) {
      res.status(400).json({ error: 'offlineAlertsPausedUntil must be a timestamp.' });
      return;
    }
    const next = await settings.update({
      offlineAlertsPaused: paused,
      ...(until !== undefined && until !== null ? { offlineAlertsPausedUntil: Number(until) } : {})
    }, String(res.locals.localControlUid || '') || undefined);
    await monitor.refreshAlertState();
    res.json({ ...next, health: monitor.getStatus() });
  }));
}
