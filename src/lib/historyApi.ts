export interface SpaHistoryEventDto {
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

export interface SpaHistoryResponseDto {
  events: SpaHistoryEventDto[];
  total: number;
}

export async function fetchSpaHistory(): Promise<SpaHistoryResponseDto> {
  const response = await fetch('/api/history/spa-events');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Spa history request failed (${response.status})`);
  }
  return response.json();
}
