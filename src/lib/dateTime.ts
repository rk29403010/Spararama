export function formatLogDateTime(timestamp: number, timeFormat: '12h' | '24h' = '24h') {
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h'
  }).format(new Date(timestamp));
}

export function formatLogTime(timestamp: number, timeFormat: '12h' | '24h' = '24h') {
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h'
  }).format(new Date(timestamp));
}
