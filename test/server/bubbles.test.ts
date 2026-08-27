import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';
import { BubbleSessionManager } from '../../server/spa/bubbles';

class BubbleTestAdapter implements SpaAdapter {
  status: SpaStatus = {
    transport: 'mock',
    connected: true,
    waterTemperatureC: 38,
    targetTemperatureC: 40,
    heaterOn: false,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0,
    updatedAt: Date.now()
  };
  bubbleStarts = 0;

  async getStatus() { return { ...this.status }; }
  async setHeater(on: boolean) { this.status.heaterOn = on; return this.getStatus(); }
  async setFilter(on: boolean) { this.status.filterOn = on; return this.getStatus(); }
  async setTargetTemperature(celsius: number) { this.status.targetTemperatureC = celsius; return this.getStatus(); }
  async setBubbles(on: boolean) {
    this.status.bubblesOn = on;
    if (on) this.bubbleStarts += 1;
    this.status.updatedAt = Date.now();
    return this.getStatus();
  }
}

test('manual bubble stop does not create a cooldown', async () => {
  const adapter = new BubbleTestAdapter();
  const manager = new BubbleSessionManager(adapter, { runLimitSeconds: 20, cooldownSeconds: 10 });
  await manager.setBubbles(true);
  const stopped = await manager.setBubbles(false);
  assert.equal(stopped.bubblePhase, 'idle');
  assert.equal(stopped.bubbleCooldownEndsAt, undefined);
});

test('safety cutoff enters cooldown and warns one minute before restart', async () => {
  const adapter = new BubbleTestAdapter();
  const announcements: string[] = [];
  const manager = new BubbleSessionManager(adapter, { runLimitSeconds: 120, cooldownSeconds: 120 }, async text => { announcements.push(text); });
  const started = await manager.setBubbles(true);
  assert.ok(started.bubbleRunEndsAt);

  await manager.process(started.bubbleRunEndsAt!);
  const cooling = manager.decorate(await adapter.getStatus());
  assert.equal(cooling.bubblePhase, 'cooldown');
  assert.ok(cooling.bubbleCooldownEndsAt);

  await manager.process(cooling.bubbleCooldownEndsAt! - 60_000);
  assert.deepEqual(announcements, ['Hot tub bubbles can start again in one minute.']);
});

test('auto restart happens once and cannot loop', async () => {
  const adapter = new BubbleTestAdapter();
  const manager = new BubbleSessionManager(adapter, { runLimitSeconds: 20, cooldownSeconds: 10 });
  const started = await manager.setBubbles(true, { autoRestart: true });
  assert.ok(started.bubbleRunEndsAt);

  await manager.process(started.bubbleRunEndsAt!);
  const firstCooldown = manager.decorate(await adapter.getStatus());
  assert.ok(firstCooldown.bubbleCooldownEndsAt);
  await manager.process(firstCooldown.bubbleCooldownEndsAt!);

  const restarted = manager.decorate(await adapter.getStatus());
  assert.equal(restarted.bubblePhase, 'running');
  assert.equal(restarted.bubbleAutoRestartUsed, true);
  assert.equal(restarted.bubbleAutoRestartEnabled, false);
  assert.equal(adapter.bubbleStarts, 2);

  assert.ok(restarted.bubbleRunEndsAt);
  await manager.process(restarted.bubbleRunEndsAt!);
  const secondCooldown = manager.decorate(await adapter.getStatus());
  assert.ok(secondCooldown.bubbleCooldownEndsAt);
  await manager.process(secondCooldown.bubbleCooldownEndsAt!);
  assert.equal(adapter.bubbleStarts, 2);
});

test('a lagging on-status does not erase a known cooldown', async () => {
  const adapter = new BubbleTestAdapter();
  const manager = new BubbleSessionManager(adapter, { runLimitSeconds: 20, cooldownSeconds: 10 });
  const started = await manager.setBubbles(true);
  assert.ok(started.bubbleRunEndsAt);
  await manager.process(started.bubbleRunEndsAt!);

  const status = await manager.getStatus();
  assert.equal(status.bubblePhase, 'cooldown');
  assert.equal(status.bubbleTimingKnown, true);
});
