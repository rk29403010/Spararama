import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RemoteAgent } from '../../server/remote/agent';
import { RemoteCommandExecutor } from '../../server/remote/executor';
import { resolveRemoteRuntimeConfig } from '../../server/remote/factory';
import { FileRemoteCommandLedger, MemoryRemoteCommandLedger } from '../../server/remote/ledger';
import { InMemoryRemoteTransport } from '../../server/remote/transports';
import type { RemoteCommandEnvelope } from '../../server/remote/types';
import { BubbleSessionManager } from '../../server/spa/bubbles';
import type { SpaAdapter, SpaStatus } from '../../server/spa/types';

const NOW = 1_800_000_000_000;

function status(overrides: Partial<SpaStatus> = {}): SpaStatus {
  return {
    transport: 'lan',
    connected: true,
    waterTemperatureC: 35,
    targetTemperatureC: 38,
    heaterOn: false,
    filterOn: true,
    bubblesOn: false,
    filterRuntimeSeconds: 0,
    heaterRuntimeSeconds: 0,
    updatedAt: NOW,
    ...overrides
  };
}

function testAdapter(overrides: Partial<SpaStatus> = {}) {
  let current = status(overrides);
  const calls = {
    heater: 0,
    filter: 0,
    bubbles: 0,
    target: 0
  };
  const spa: SpaAdapter = {
    getStatus: async () => ({ ...current }),
    setHeater: async on => {
      calls.heater += 1;
      current = { ...current, heaterOn: on, updatedAt: NOW };
      return { ...current };
    },
    setFilter: async on => {
      calls.filter += 1;
      current = { ...current, filterOn: on, updatedAt: NOW };
      return { ...current };
    },
    setBubbles: async on => {
      calls.bubbles += 1;
      current = { ...current, bubblesOn: on, updatedAt: NOW };
      return { ...current };
    },
    setTargetTemperature: async celsius => {
      calls.target += 1;
      current = { ...current, targetTemperatureC: celsius, updatedAt: NOW };
      return { ...current };
    }
  };
  return { spa, calls };
}

function command(
  commandId: string,
  type: string,
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) {
  return {
    version: 1,
    commandId,
    installationId: 'home-spa',
    type,
    payload,
    createdAt: NOW - 1_000,
    expiresAt: NOW + 30_000,
    requestedBy: { kind: 'user', id: 'user-1' },
    ...overrides
  } as unknown as RemoteCommandEnvelope;
}

test('remote desired-state command executes once and duplicate delivery replays the stored result', async () => {
  const { spa, calls } = testAdapter();
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    ledger: new MemoryRemoteCommandLedger(),
    now: () => NOW
  });

  const first = await executor.execute(command('cmd-1', 'setHeater', { on: true }));
  const duplicate = await executor.execute(command('cmd-1', 'setHeater', { on: true }));

  assert.equal(first.status, 'succeeded');
  assert.deepEqual(duplicate, first);
  assert.equal(calls.heater, 1);
});

test('remote desired-state command avoids repeating a side effect already reflected by the spa', async () => {
  const { spa, calls } = testAdapter({ heaterOn: true });
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    now: () => NOW
  });

  const result = await executor.execute(command('cmd-2', 'setHeater', { on: true }));
  assert.equal(result.status, 'succeeded');
  assert.equal(calls.heater, 0);
});

test('expired remote command is recorded as expired without touching hardware', async () => {
  const { spa, calls } = testAdapter();
  const ledger = new MemoryRemoteCommandLedger();
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    ledger,
    now: () => NOW
  });

  const result = await executor.execute(command('cmd-3', 'setFilter', { on: false }, {
    createdAt: NOW - 60_000,
    expiresAt: NOW - 1
  }));

  assert.equal(result.status, 'expired');
  assert.equal(result.error?.code, 'expired');
  assert.equal(calls.filter, 0);
  assert.deepEqual(await ledger.get('cmd-3'), result);
});

test('malformed and unknown commands are rejected locally', async () => {
  const { spa } = testAdapter();
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    now: () => NOW
  });

  const malformed = await executor.execute(command('cmd-4', 'setHeater', { on: 'yes' as unknown as boolean }));
  assert.equal(malformed.status, 'rejected');
  assert.equal(malformed.error?.code, 'invalid_command');

  const unknown = await executor.execute(command('cmd-5', 'launchMissiles', {}));
  assert.equal(unknown.status, 'rejected');
  assert.equal(unknown.error?.code, 'unsupported_command');
});

test('immediate remote control reports an unavailable spa without invoking the adapter setter', async () => {
  const { spa, calls } = testAdapter({ connected: false });
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    now: () => NOW
  });

  const result = await executor.execute(command('cmd-6', 'setTargetTemperature', { celsius: 39 }));
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'spa_unavailable');
  assert.equal(calls.target, 0);
});

test('remote bubbles pass through BubbleSessionManager safety handling', async () => {
  const { spa, calls } = testAdapter();
  const bubbles = new BubbleSessionManager(spa, { runLimitSeconds: 20 * 60, cooldownSeconds: 10 * 60 });
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    bubbles,
    now: () => NOW
  });

  const result = await executor.execute(command('cmd-7', 'setBubbles', { on: true, autoRestart: true }));
  assert.equal(result.status, 'succeeded');
  assert.equal(calls.bubbles, 1);
  assert.equal((result.result as any).bubbleAutoRestartEnabled, true);
});

test('remote ready-at command delegates to the shared planner with caller metadata', async () => {
  const { spa } = testAdapter();
  const received: any[] = [];
  const readyPlanner = {
    scheduleReadyAt: async (input: any, now: number) => {
      received.push({ input, now });
      return { ...input, startTime: now, canMeetTarget: true };
    }
  };
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    readyPlanner,
    now: () => NOW
  });

  const result = await executor.execute(command('cmd-ready', 'scheduleReadyAt', {
    targetTime: NOW + 3_600_000,
    targetTemperatureC: 39,
    heatSoakMinutes: 30
  }));

  assert.equal(result.status, 'succeeded');
  assert.equal(received.length, 1);
  assert.equal(received[0].now, NOW);
  assert.equal(received[0].input.targetTime, NOW + 3_600_000);
  assert.equal(received[0].input.targetTemperatureC, 39);
  assert.equal(received[0].input.heatSoakMinutes, 30);
  assert.equal(received[0].input.sessionData.source, 'remote');
  assert.deepEqual(received[0].input.sessionData.requestedBy, { kind: 'user', id: 'user-1' });
});

test('remote ready-at command rejects a target time that has already passed', async () => {
  const { spa } = testAdapter();
  let calls = 0;
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    readyPlanner: {
      scheduleReadyAt: async () => {
        calls += 1;
        return {};
      }
    },
    now: () => NOW
  });

  const result = await executor.execute(command('cmd-ready-old', 'scheduleReadyAt', {
    targetTime: NOW - 1
  }));

  assert.equal(result.status, 'rejected');
  assert.equal(result.error?.code, 'invalid_command');
  assert.equal(calls, 0);
});

test('remote heating schedule uses the existing scheduler and a deterministic command-based id', async () => {
  const { spa } = testAdapter();
  const received: any[] = [];
  const heating = {
    createSchedule: async (input: any) => {
      received.push(input);
      return { ...input, status: 'scheduled' };
    }
  };
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    heating,
    now: () => NOW
  });

  const result = await executor.execute(command('cmd-8', 'createHeatingSchedule', {
    startTime: NOW + 60_000,
    targetTime: NOW + 3_600_000,
    startTemperatureC: 35,
    targetTemperatureC: 39,
    autoStartPreferred: true,
    heatSoakMinutes: 30
  }));

  assert.equal(result.status, 'succeeded');
  assert.equal(received.length, 1);
  assert.equal(received[0].id, 'remote-cmd-8');
  assert.equal(received[0].sessionData.source, 'remote');
  assert.deepEqual(received[0].sessionData.requestedBy, { kind: 'user', id: 'user-1' });
});

test('file command ledger survives a process-style re-instantiation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spararama-remote-ledger-'));
  try {
    const first = new FileRemoteCommandLedger(dir);
    const result = {
      version: 1 as const,
      commandId: 'persisted-command',
      installationId: 'home-spa',
      type: 'setHeater',
      status: 'succeeded' as const,
      acceptedAt: NOW,
      completedAt: NOW,
      requestedBy: { kind: 'user' as const, id: 'user-1' },
      result: { heaterOn: true }
    };
    await first.record(result);

    const reopened = new FileRemoteCommandLedger(dir);
    assert.deepEqual(await reopened.get('persisted-command'), result);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('in-memory transport and RemoteAgent exercise the provider-neutral delivery contract', async () => {
  const { spa, calls } = testAdapter();
  const transport = new InMemoryRemoteTransport();
  const executor = new RemoteCommandExecutor({
    installationId: 'home-spa',
    spa,
    now: () => NOW
  });
  const agent = new RemoteAgent('home-spa', transport, executor);
  let completed = 0;
  agent.setCommandCompletedHandler(() => { completed += 1; });

  await agent.start();
  await transport.deliver(command('cmd-9', 'setFilter', { on: false }));

  assert.equal(calls.filter, 1);
  assert.equal(transport.acknowledgements.length, 1);
  assert.equal(transport.acknowledgements[0].status, 'succeeded');
  assert.equal(completed, 1);
  assert.equal(agent.getStatus().provider, 'memory');
  await agent.stop();
});


test('remote runtime configuration is disabled by default and Firebase requires an installation id', () => {
  const previousTransport = process.env.REMOTE_TRANSPORT;
  const previousInstallation = process.env.REMOTE_INSTALLATION_ID;
  try {
    delete process.env.REMOTE_TRANSPORT;
    delete process.env.REMOTE_INSTALLATION_ID;
    assert.equal(resolveRemoteRuntimeConfig().transport, 'none');

    process.env.REMOTE_TRANSPORT = 'firebase';
    delete process.env.REMOTE_INSTALLATION_ID;
    let config = resolveRemoteRuntimeConfig();
    assert.equal(config.transport, 'none');
    assert.match(config.warning || '', /requires REMOTE_INSTALLATION_ID/);

    process.env.REMOTE_INSTALLATION_ID = 'home-spa';
    config = resolveRemoteRuntimeConfig();
    assert.equal(config.transport, 'firebase');
    assert.equal(config.installationId, 'home-spa');
  } finally {
    if (previousTransport === undefined) delete process.env.REMOTE_TRANSPORT;
    else process.env.REMOTE_TRANSPORT = previousTransport;
    if (previousInstallation === undefined) delete process.env.REMOTE_INSTALLATION_ID;
    else process.env.REMOTE_INSTALLATION_ID = previousInstallation;
  }
});
