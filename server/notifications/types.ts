export type NotificationGroup =
  | 'heating.action_required'
  | 'heating.progress'
  | 'heating.schedule'
  | 'equipment'
  | 'water_care'
  | 'system';

export type NotificationSeverity = 'info' | 'warning' | 'urgent';

export interface SpararamaNotification {
  id: string;
  type: string;
  group: NotificationGroup;
  severity: NotificationSeverity;
  title: string;
  message: string;
  createdAt: number;
  updatedAt: number;
  incidentKey?: string;
  context?: Record<string, unknown>;
  requiresAcknowledgement: boolean;
  acknowledgedAt?: number;
  acknowledgedByUid?: string;
  resolvedAt?: number;
  resolutionReason?: string;
}

export interface PublishNotificationInput {
  type: string;
  group: NotificationGroup;
  severity: NotificationSeverity;
  title: string;
  message: string;
  incidentKey?: string;
  context?: Record<string, unknown>;
  requiresAcknowledgement?: boolean;
}

export type NotificationDeliveryStatus = 'provider_accepted' | 'failed';

export interface NotificationDelivery {
  id: string;
  notificationId: string;
  route: 'push';
  targetId: string;
  targetLabel?: string;
  status: NotificationDeliveryStatus;
  attemptedAt: number;
  providerAcceptedAt?: number;
  retryable?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface NotificationStateFile {
  notifications: SpararamaNotification[];
  deliveries: NotificationDelivery[];
}

export type NotificationEventType =
  | 'notification_opened'
  | 'notification_updated'
  | 'notification_escalated'
  | 'notification_acknowledged'
  | 'notification_resolved';

export interface NotificationEventRecord {
  id: string;
  notificationId: string;
  timestamp: number;
  type: NotificationEventType;
  details?: Record<string, unknown>;
}
