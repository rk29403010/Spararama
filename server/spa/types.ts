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
  updatedAt: number;
}

export interface SpaAdapter {
  getStatus(): Promise<SpaStatus>;
  setHeater(on: boolean): Promise<SpaStatus>;
  setFilter(on: boolean): Promise<SpaStatus>;
  setBubbles(on: boolean): Promise<SpaStatus>;
  setTargetTemperature(celsius: number): Promise<SpaStatus>;
}
