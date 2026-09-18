import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CloudControlError,
  CloudControlService,
  type CloudControlStore,
  type InstallationMembership,
  type InstallationRuntimeDocument,
  type StoredCloudCommand,
  type CommandRateLimiter
} from '../../server/remote/cloud/service';
import type { RemoteCommandEnvelope } from '../../server/remote/types';

const NOW = 1_800_000_000_000;

class FakeStore implements CloudControlStore {
  memberships: InstallationMembership[] = [
    { installationId: 'home-spa', role: 'owner', name: 'Home hot tub' },
    { installationId: 'view-only', role: 'viewer', name: 'Other spa' }
  ];
  runtime = new Map<string, InstallationRuntimeDocument>();
  commands = new Map<string, StoredCloudCommand>();
  created: RemoteCommandEnvelope[] = [];

  async listMemberships(uid: string) {
    return uid === 'user-1' ? this.memberships : [];
  }

  async getMembership(installationId: string, uid: string) {
    if (uid !== 'user-1') return null;
    return this.memberships.find(item => item.installationId === installationId) || null;
  }

  async getRuntime(installationId: string) {
    return this.runtime.get(installationId) || null;
  }

  async createCommand(command: RemoteCommandEnvelope) {
    this.created.push(command);
    this.commands.set(command.commandId, {
      ...command,
      status: 'queued'
    });
  }

  async getCommand(installationId: string, commandId: string) {
    const command = this.commands.get(commandId);
    return command?.installationId === installationId ? command : null;
  }
}

const principal = { uid: 'user-1', email: 'user@example.com' };

test('cloud control lists only installations visible to the authenticated principal', async () => {
  const service = new CloudControlService(new FakeStore(), { now: () => NOW });
  assert.deepEqual(await service.listInstallations(principal), [
    { installationId: 'home-spa', role: 'owner', name: 'Home hot tub' },
    { installationId: 'view-only', role: 'viewer', name: 'Other spa' }
  ]);
  assert.deepEqual(await service.listInstallations({ uid: 'stranger' }), []);
});

test('cloud state reports freshness without presenting old data as live', async () => {
  const store = new FakeStore();
  store.runtime.set('home-spa', {
    heartbeatAtMs: NOW - 20_000,
    statePublishedAtMs: NOW - 25_000,
    state: { spa: { connected: true } }
  });
  const service = new CloudControlService(store, { now: () => NOW });
  const current = await service.getInstallationState(principal, 'home-spa');
  assert.equal(current.freshness.status, 'fresh');
  assert.equal(current.freshness.ageMs, 20_000);

  store.runtime.set('home-spa', { heartbeatAtMs: NOW - 120_000 });
  assert.equal((await service.getInstallationState(principal, 'home-spa')).freshness.status, 'stale');

  store.runtime.set('home-spa', { heartbeatAtMs: NOW - 600_000 });
  assert.equal((await service.getInstallationState(principal, 'home-spa')).freshness.status, 'offline');
});

test('owner command submission creates server-timestamped short-lived typed work', async () => {
  const store = new FakeStore();
  const service = new CloudControlService(store, { now: () => NOW });

  const response = await service.submitCommand(principal, 'home-spa', {
    type: 'setTargetTemperature',
    payload: { celsius: 39 }
  });

  assert.equal(response.status, 'queued');
  assert.equal(store.created.length, 1);
  const queued = store.created[0];
  assert.equal(queued.installationId, 'home-spa');
  assert.equal(queued.type, 'setTargetTemperature');
  assert.deepEqual(queued.payload, { celsius: 39 });
  assert.deepEqual(queued.requestedBy, { kind: 'user', id: 'user-1' });
  assert.equal(queued.createdAt, NOW);
  assert.equal(queued.expiresAt, NOW + 30_000);
});

test('cloud command validation rejects unsupported or malformed control requests', async () => {
  const service = new CloudControlService(new FakeStore(), { now: () => NOW });

  await assert.rejects(
    service.submitCommand(principal, 'home-spa', { type: 'setHeater', payload: { on: 'yes' } }),
    (error: any) => error instanceof CloudControlError
      && error.statusCode === 400
      && error.code === 'invalid_command'
  );

  await assert.rejects(
    service.submitCommand(principal, 'home-spa', { type: 'deleteEverything', payload: {} }),
    (error: any) => error instanceof CloudControlError
      && error.statusCode === 400
      && error.code === 'unsupported_command'
  );
});

test('viewer and unauthorised principals cannot submit physical commands', async () => {
  const service = new CloudControlService(new FakeStore(), { now: () => NOW });

  await assert.rejects(
    service.submitCommand(principal, 'view-only', { type: 'setFilter', payload: { on: false } }),
    (error: any) => error instanceof CloudControlError
      && error.statusCode === 403
      && error.code === 'read_only'
  );

  await assert.rejects(
    service.getInstallationState({ uid: 'stranger' }, 'home-spa'),
    (error: any) => error instanceof CloudControlError
      && error.statusCode === 403
      && error.code === 'forbidden'
  );
});

test('cloud command status requires membership and preserves the stored result', async () => {
  const store = new FakeStore();
  const service = new CloudControlService(store, { now: () => NOW });
  const queued = await service.submitCommand(principal, 'home-spa', {
    type: 'setFilter',
    payload: { on: false }
  });
  const command = await service.getCommand(principal, 'home-spa', queued.commandId);
  assert.equal(command.commandId, queued.commandId);
  assert.equal(command.status, 'queued');

  await assert.rejects(
    service.getCommand({ uid: 'stranger' }, 'home-spa', queued.commandId),
    (error: any) => error instanceof CloudControlError && error.statusCode === 403
  );
});

test('rate limiting is enforced before queue growth', async () => {
  const store = new FakeStore();
  const limiter: CommandRateLimiter = {
    consume: (() => {
      let remaining = 1;
      return () => remaining-- > 0;
    })()
  };
  const service = new CloudControlService(store, { now: () => NOW, limiter });

  await service.submitCommand(principal, 'home-spa', { type: 'readStatus', payload: {} });
  await assert.rejects(
    service.submitCommand(principal, 'home-spa', { type: 'readStatus', payload: {} }),
    (error: any) => error instanceof CloudControlError
      && error.statusCode === 429
      && error.code === 'rate_limited'
  );
  assert.equal(store.created.length, 1);
});

test('heating schedule command is validated at the public boundary', async () => {
  const store = new FakeStore();
  const service = new CloudControlService(store, { now: () => NOW });

  await service.submitCommand(principal, 'home-spa', {
    type: 'createHeatingSchedule',
    payload: {
      startTime: NOW + 60_000,
      targetTime: NOW + 3_600_000,
      startTemperatureC: 35,
      targetTemperatureC: 39,
      autoStartPreferred: true,
      heatSoakMinutes: 30
    }
  });

  assert.equal(store.created[0].type, 'createHeatingSchedule');
  assert.equal(store.created[0].expiresAt, NOW + 60_000);

  await assert.rejects(
    service.submitCommand(principal, 'home-spa', {
      type: 'createHeatingSchedule',
      payload: {
        startTime: NOW + 120_000,
        targetTime: NOW + 60_000,
        startTemperatureC: 35,
        targetTemperatureC: 39,
        autoStartPreferred: true
      }
    }),
    (error: any) => error instanceof CloudControlError && error.statusCode === 400
  );
});
