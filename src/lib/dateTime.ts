type TimeFormat = '12h' | '24h';

function hourDisplay(timeFormat: TimeFormat): 'numeric' | '2-digit' {
  return timeFormat === '12h' ? 'numeric' : '2-digit';
}

export function formatLogDateTime(timestamp: number, timeFormat: TimeFormat = '24h') {
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: hourDisplay(timeFormat),
    minute: '2-digit',
    hour12: timeFormat === '12h'
  }).format(new Date(timestamp));
}

export function formatLogTime(timestamp: number, timeFormat: TimeFormat = '24h') {
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    hour: hourDisplay(timeFormat),
    minute: '2-digit',
    hour12: timeFormat === '12h'
  }).format(new Date(timestamp));
}
