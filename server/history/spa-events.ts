import fs from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';

export interface SpaHistoryEvent {
  schema: string;
  id: string;
  observed_at: unknown;
  time_precision?: string;
  type: string;
  water_source?: string;
  values?: Record<string, unknown>;
  chemical?: string;
  dose_g?: number | null;
  spoon_measure?: string;
  action?: string;
  test?: string;
  details?: Record<string, unknown>;
  notes?: string;
  source?: string;
}

async function readSpaEvents() {
  const filePath = path.join(process.cwd(), 'history', 'spa-events.jsonl');
  let text = '';
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [] as SpaHistoryEvent[];
    throw error;
  }

  const events: SpaHistoryEvent[] = [];
  let lineNumber = 0;
  for (const line of text.split(/\r?\n/)) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      throw new Error(`Malformed spa history entry at line ${lineNumber}.`);
    }
  }
  return events;
}

export function registerSpaHistoryRoutes(app: Express) {
  app.get('/api/history/spa-events', async (_req, res) => {
    try {
      const events = await readSpaEvents();
      res.json({ events, total: events.length });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Unable to read spa event history' });
    }
  });
}
