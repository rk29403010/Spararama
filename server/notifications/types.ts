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
  expiresAt?: number;
  incidentKey?: string;
  context?: Record<string, unknown>;
  requiresAcknowledgement: boolean;
  deliverySuppressed?: boolean;
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
  expiresAt?: number;
  incidentKey?: string;
  context?: Record<string, unknown>;
  requiresAcknowledgement?: boolean;
  deliverySuppressed?: boolean;
}

export type NotificationDeliveryStatus = 'provider_accepted' | 'failed';
export type NotificationDeliveryRoute = 'push' | 'alexa';

export interface NotificationDelivery {
  id: string;
  notificationId: string;
  route: NotificationDeliveryRoute;
  targetId: string;
  targetLabel?: string;
  status: NotificationDeliveryStatus;
  attemptNumber: number;
  attemptedAt: number;
  providerAcceptedAt?: number;
  retryable?: boolean;
  nextAttemptAt?: number;
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
