import { timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { AlexaSpaCommandService, handleAlexaDirectRequest } from './direct';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Direct Alexa request failed' });
    });
  };
}

function enabled() {
  return String(process.env.ALEXA_DIRECT_ENABLED || '').toLowerCase() === 'true';
}

function secureEqual(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireAlexaProxy(req: Request, res: Response) {
  if (!enabled()) {
    res.status(404).json({ error: 'Direct Alexa integration is disabled.' });
    return false;
  }

  const expectedSecret = String(process.env.ALEXA_DIRECT_PROXY_SECRET || '').trim();
  if (!expectedSecret) {
    res.status(503).json({ error: 'Direct Alexa integration has no proxy secret configured.' });
    return false;
  }
  const suppliedSecret = String(req.headers['x-spararama-alexa-proxy-secret'] || '');
  if (!secureEqual(suppliedSecret, expectedSecret)) {
    res.status(401).json({ error: 'Invalid Alexa proxy credential.' });
    return false;
  }

  const expectedSkillId = String(process.env.ALEXA_SKILL_ID || '').trim();
  if (expectedSkillId) {
    const suppliedSkillId = String(req.headers['x-spararama-alexa-skill-id'] || '').trim();
    if (!secureEqual(suppliedSkillId, expectedSkillId)) {
      res.status(403).json({ error: 'Alexa skill ID does not match this Spararama installation.' });
      return false;
    }
  }
  return true;
}

export function registerDirectAlexaRoutes(app: Express, commands: AlexaSpaCommandService) {
  app.post('/api/alexa/direct', asyncRoute(async (req, res) => {
    if (!requireAlexaProxy(req, res)) return;
    res.json(await handleAlexaDirectRequest(req.body, commands));
  }));
}
