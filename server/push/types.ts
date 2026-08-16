export interface PushRegistration {
  id: string;
  token: string;
  createdAt: number;
  updatedAt: number;
  userAgent?: string;
  label?: string;
}

export interface PushRegistryState {
  registrations: PushRegistration[];
}

export interface PushDeliveryResult {
  enabled: boolean;
  targetCount: number;
  successCount: number;
  failureCount: number;
  retryableFailureCount: number;
  removedInvalidCount: number;
  error?: string;
}
