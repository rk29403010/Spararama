import express, { type Express, type Request, type Response } from 'express';
import type { CloudAuthenticator } from './firebase-auth';
import { CloudControlError, type CloudControlService, type CloudPrincipal } from './service';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch(error => {
      const normalized = error instanceof CloudControlError
        ? error
        : new CloudControlError(500, 'internal_error', error instanceof Error ? error.message : 'Cloud request failed.');
      if (normalized.statusCode >= 500) console.error(error);
      res.status(normalized.statusCode).json({
        error: normalized.code,
        message: normalized.statusCode >= 500 ? 'Spararama cloud request failed.' : normalized.message
      });
    });
  };
}

function allowedOrigins() {
  return new Set(
    String(process.env.SPARARAMA_CLOUD_ALLOWED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
}

export function createCloudControlApp(dependencies: {
  service: CloudControlService;
  authenticator: CloudAuthenticator;
}): Express {
  const app = express();
  const origins = allowedOrigins();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = String(req.headers.origin || '');
    if (origin && origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'spararama-cloud-control' });
  });

  async function principal(req: Request): Promise<CloudPrincipal> {
    return dependencies.authenticator.authenticateAuthorizationHeader(
      typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined
    );
  }

  app.get('/api/installations', asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ installations: await dependencies.service.listInstallations(await principal(req)) });
  }));

  app.get('/api/installations/:installationId/state', asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await dependencies.service.getInstallationState(
      await principal(req),
      req.params.installationId
    ));
  }));

  app.post('/api/installations/:installationId/commands', asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const queued = await dependencies.service.submitCommand(
      await principal(req),
      req.params.installationId,
      req.body
    );
    res.status(202).json(queued);
  }));

  app.get('/api/installations/:installationId/commands/:commandId', asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await dependencies.service.getCommand(
      await principal(req),
      req.params.installationId,
      req.params.commandId
    ));
  }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'No such Spararama cloud endpoint.' });
  });

  return app;
}
