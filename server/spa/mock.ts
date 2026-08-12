import type { SpaAdapter, SpaStatus } from './types';

export class MockSpaAdapter implements SpaAdapter {
  private state: SpaStatus = {
    transport: 'mock',
    connected: true,
    waterTemperatureC: 28,
    targetTemperatureC: 38,
    heaterOn: false,
    filterOn: false,
    bubblesOn: false,
    updatedAt: Date.now()
  };

  private lastSimulationAt = Date.now();

  private simulate() {
    const now = Date.now();
    const elapsedHours = (now - this.lastSimulationAt) / 3_600_000;
    this.lastSimulationAt = now;

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
