import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CloudControlError,
  CloudControlService,
  type CloudControlStore,
  type CommandRateLimiter,
  type InstallationMembership,
  type InstallationRuntimeDocument,
  type StoredCloudCommand
} from '../../server/remote/cloud/service';
import type { RemoteCommandEnvelope } from '../../server/remote/types';

const NOW = 1_800_000_000_000;

class Store implements CloudControlStore {
  created: RemoteCommandEnvelope[] = [];
  async listMemberships(_uid: string): Promise<InstallationMembership[]> { return []; }
  async getMembership(installationId: string, uid: string) {
    return uid === 'owner' ? { installationId, role: 'owner' as const } : null;
  }
  async getRuntime(_installationId: string): Promise<InstallationRuntimeDocument | null> { return null; }
  async createCommand(command: RemoteCommandEnvelope) { this.created.push(command); }
  async getCommand(_installationId: string, _commandId: string): Promise<StoredCloudCommand | null> { return null; }
}

test('CloudControlService awaits an asynchronous distributed limiter before queue growth', async () => {
  const store = new Store();
  let calls = 0;
  const limiter: CommandRateLimiter = {
    consume: async () => {
      calls += 1;
      await Promise.resolve();
      return calls === 1;
    }
  };
  const service = new CloudControlService(store, { now: () => NOW, limiter });
  const principal = { uid: 'owner' };

  await service.submitCommand(principal, 'home-spa', { type: 'readStatus', payload: {} });
  await assert.rejects(
    service.submitCommand(principal, 'home-spa', { type: 'readStatus', payload: {} }),
    (error: any) => error instanceof CloudControlError && error.code === 'rate_limited'
  );

  assert.equal(calls, 2);
  assert.equal(store.created.length, 1);
});

test('Cloud Run wires the Firestore transaction-backed limiter rather than the process-local limiter', () => {
  const source = readFileSync('services/cloud/server.ts', 'utf8');
  const firebaseStore = readFileSync('server/remote/cloud/firebase-store.ts', 'utf8');

  assert.match(source, /new FirestoreCommandRateLimiter\(\)/);
  assert.match(source, /new CloudControlService\(store, \{ limiter:/);
  assert.match(firebaseStore, /runTransaction/);
  assert.match(firebaseStore, /cloudCommandRateLimits/);
});
