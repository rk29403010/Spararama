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

export interface PushTargetDeliveryResult {
  registrationId: string;
  label?: string;
  userAgent?: string;
  success: boolean;
  invalid: boolean;
  retryable: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface PushDeliveryResult {
  enabled: boolean;
  targetCount: number;
  successCount: number;
  failureCount: number;
  retryableFailureCount: number;
  removedInvalidCount: number;
  targets: PushTargetDeliveryResult[];
  error?: string;
}
