export type TemperatureHistoryRange = 'daily' | '48h' | '7d' | '30d' | '1y';

export interface TemperatureWindow {
  since: number;
  end: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function readyTimeOn(date: Date, readyTime: string) {
  const [hourRaw, minuteRaw] = readyTime.split(':').map(Number);
  const copy = new Date(date);
  copy.setHours(Number.isFinite(hourRaw) ? hourRaw : 17, Number.isFinite(minuteRaw) ? minuteRaw : 0, 0, 0);
  return copy.getTime();
}

export function temperatureWindow(range: TemperatureHistoryRange, page: number, now = Date.now(), readyTime = '17:00'): TemperatureWindow {
  const safePage = Math.max(0, Math.floor(page) || 0);
  const current = new Date(now);

  if (range === 'daily') {
    const start = new Date(current);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - safePage);
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    const end = safePage === 0 ? Math.max(now, readyTimeOn(start, readyTime)) : next.getTime();
    return { since: start.getTime(), end };
  }

  const duration = range === '48h' ? 2 * DAY_MS : range === '7d' ? 7 * DAY_MS : range === '30d' ? 30 * DAY_MS : 365 * DAY_MS;
  const latestEnd = range === '48h' ? Math.max(now, readyTimeOn(current, readyTime)) : now;
  const end = latestEnd - safePage * duration;
  return { since: end - duration, end };
}

export function temperatureWindowLabel(range: TemperatureHistoryRange, window: TemperatureWindow) {
  const start = new Date(window.since);
  const end = new Date(Math.max(window.since, window.end - 1));
  const full = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (range === 'daily') return full.format(start);

  const compact = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${compact.format(start)} – ${compact.format(end)}`;
}
