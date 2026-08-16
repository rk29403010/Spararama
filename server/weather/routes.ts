import type { Express, Request, Response } from 'express';
import type { WeatherService } from './service';
import { validateWeatherSettings } from './settings';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.error(error);
      res.status(500).json({ error: error?.message || 'Weather request failed' });
    });
  };
}

export function registerWeatherRoutes(app: Express, weather: WeatherService) {
  app.get('/api/weather/config', asyncRoute(async (_req, res) => {
    res.json(await weather.getSettings());
  }));

  app.put('/api/weather/config', asyncRoute(async (req, res) => {
    try {
      res.json(await weather.setSettings(validateWeatherSettings(req.body)));
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Invalid weather settings' });
    }
  }));

  app.get('/api/weather/lookup', asyncRoute(async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) {
      res.status(400).json({ error: 'Enter at least two characters of a place name or postcode.' });
      return;
    }
    res.json(await weather.lookup(query));
  }));

  app.get('/api/weather/current', asyncRoute(async (_req, res) => {
    res.json(await weather.current());
  }));

  app.get('/api/weather/forecast', asyncRoute(async (req, res) => {
    const days = Number(req.query.days || 2);
    res.json(await weather.forecast(Number.isFinite(days) ? days : 2));
  }));
}
