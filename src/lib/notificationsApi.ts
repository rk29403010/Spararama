export type NotificationSeverity = 'info' | 'warning' | 'urgent';

export interface SpararamaNotificationDto {
  id: string;
  type: string;
  group: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  createdAt: number;
  updatedAt: number;
  incidentKey?: string;
  context?: Record<string, unknown>;
  requiresAcknowledgement: boolean;
  acknowledgedAt?: number;
  resolvedAt?: number;
}

export async function listActiveNotifications() {
  const response = await fetch('/api/notifications', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Notification request failed (${response.status}).`);
  return response.json() as Promise<{ notifications: SpararamaNotificationDto[] }>;
}
