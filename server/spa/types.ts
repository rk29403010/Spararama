export interface SpaStatus {
  transport: 'mock' | 'lan' | 'cloud' | 'manual';
  connected: boolean;
  waterTemperatureC: number;
  targetTemperatureC: number;
  heaterOn: boolean;
  filterOn: boolean;
  bubblesOn: boolean;
  filterRuntimeSeconds: number;
  heaterRuntimeSeconds: number;
  deviceFilterMinutes?: number;
  /** Timestamp of the data currently displayed. Preserved when a connection drops. */
  updatedAt: number;
  /** Last time the backend successfully contacted the spa. */
  lastContactAt?: number;
  /** Consecutive backend status cycles that could not contact the spa. */
  contactFailureCount?: number;
}

export type SpaAdapterEvent =
  | { kind: 'status'; observedAt: number; status: SpaStatus; source?: string }
  | { kind: 'connection'; observedAt: number; connected: boolean; source?: string };

export type SpaAdapterEventListener = (event: SpaAdapterEvent) => void | Promise<void>;

export interface SpaAdapter {
  getStatus(): Promise<SpaStatus>;
  connect?(): Promise<SpaStatus>;
  setHeater(on: boolean): Promise<SpaStatus>;
  setFilter(on: boolean): Promise<SpaStatus>;
  setBubbles(on: boolean): Promise<SpaStatus>;
  setTargetTemperature(celsius: number): Promise<SpaStatus>;
  /**
   * Optional push/event capability. Poll-only, cloud-backed and manual adapters do
   * not need to implement this. The application must always retain polling and
   * manual observation paths when it is absent or unavailable.
   */
  subscribe?(listener: SpaAdapterEventListener): () => void;
}
