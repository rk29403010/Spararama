import type { SpaAdapter, SpaStatus } from './types';

export class MockSpaAdapter implements SpaAdapter {
  private state: SpaStatus;
  private lastSimulationAt: number;

  constructor(private readonly now: () => number = Date.now) {
    const timestamp = this.now();
    this.lastSimulationAt = timestamp;
    this.state = {
      transport: 'mock',
      connected: true,
      waterTemperatureC: 28,
      targetTemperatureC: 38,
      heaterOn: false,
      filterOn: false,
      bubblesOn: false,
      filterRuntimeSeconds: 0,
      heaterRuntimeSeconds: 0,
      updatedAt: timestamp
    };
  }

  private simulate() {
    const now = this.now();
    const elapsedSeconds = Math.max(0, (now - this.lastSimulationAt) / 1000);
    const elapsedHours = elapsedSeconds / 3600;
    this.lastSimulationAt = now;

    if (this.state.filterOn) this.state.filterRuntimeSeconds += elapsedSeconds;
    if (this.state.heaterOn) this.state.heaterRuntimeSeconds += elapsedSeconds;

    if (elapsedHours > 0) {
      if (this.state.heaterOn && this.state.filterOn && this.state.waterTemperatureC < this.state.targetTemperatureC) {
        this.state.waterTemperatureC = Math.min(
          this.state.targetTemperatureC,
          this.state.waterTemperatureC + (1.5 * elapsedHours)
        );
      } else if (!this.state.heaterOn) {
        this.state.waterTemperatureC = Math.max(5, this.state.waterTemperatureC - (0.15 * elapsedHours));
      }
    }
    this.state.updatedAt = now;
  }

  async getStatus(): Promise<SpaStatus> {
    this.simulate();
    return { ...this.state };
  }

  async setHeater(on: boolean): Promise<SpaStatus> {
    this.simulate();
    this.state.heaterOn = on;
    if (on) this.state.filterOn = true;
    return this.getStatus();
  }

  async setFilter(on: boolean): Promise<SpaStatus> {
    this.simulate();
    this.state.filterOn = on;
    if (!on) this.state.heaterOn = false;
    return this.getStatus();
  }

  async setBubbles(on: boolean): Promise<SpaStatus> {
    this.simulate();
    this.state.bubblesOn = on;
    return this.getStatus();
  }

  async setTargetTemperature(celsius: number): Promise<SpaStatus> {
    if (!Number.isFinite(celsius) || celsius < 5 || celsius > 42) {
      throw new Error('Target temperature must be between 5°C and 42°C.');
    }
    this.simulate();
    this.state.targetTemperatureC = celsius;
    return this.getStatus();
  }
}
