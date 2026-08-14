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

export interface SpaAdapter {
  getStatus(): Promise<SpaStatus>;
  connect?(): Promise<SpaStatus>;
  setHeater(on: boolean): Promise<SpaStatus>;
  setFilter(on: boolean): Promise<SpaStatus>;
  setBubbles(on: boolean): Promise<SpaStatus>;
  setTargetTemperature(celsius: number): Promise<SpaStatus>;
}
