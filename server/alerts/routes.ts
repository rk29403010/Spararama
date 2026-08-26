import type { Express } from 'express';
import type { AlexaAlertDispatcher } from './alexa-dispatcher';

export function registerAlertRoutes(app: Express, dispatcher: AlexaAlertDispatcher) {
  app.get('/api/alerts/alexa', (_req, res) => {
    res.json(dispatcher.status());
  });
}
