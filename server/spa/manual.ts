import type { SpaAdapter, SpaStatus } from './types';

function unavailable(): never {
  throw new Error('This water body has no remote control adapter configured. Record temperature and equipment state manually instead.');
}

export class ManualSpaAdapter implements SpaAdapter {
  async getStatus(): Promise<SpaStatus> {
    return {
      transport: 'manual',
      connected: false,
      waterTemperatureC: Number.NaN,
      targetTemperatureC: Number.NaN,
      heaterOn: false,
      filterOn: false,
      bubblesOn: false,
      filterRuntimeSeconds: 0,
      heaterRuntimeSeconds: 0,
      updatedAt: Date.now()
    };
  }
  async setHeater(_on: boolean): Promise<SpaStatus> { return unavailable(); }
  async setFilter(_on: boolean): Promise<SpaStatus> { return unavailable(); }
  async setBubbles(_on: boolean): Promise<SpaStatus> { return unavailable(); }
  async setTargetTemperature(_celsius: number): Promise<SpaStatus> { return unavailable(); }
}
