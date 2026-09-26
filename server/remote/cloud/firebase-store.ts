import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type { RemoteCommandEnvelope } from '../types';
import type {
  CloudControlStore,
  CommandRateLimiter,
  InstallationMembership,
  InstallationRole,
  InstallationRuntimeDocument,
  StoredCloudCommand
} from './service';
import { getCloudFirestore } from './firebase-admin';

const INSTALLATION_PERMISSIONS = new Set(['spa_control', 'heating_manage', 'water_testing', 'user_admin']);

function role(value: unknown): InstallationRole | null {
  return value === 'owner' || value === 'member' || value === 'viewer' ? value : null;
}

function permissions(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string' && INSTALLATION_PERMISSIONS.has(item));
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

/**
 * Shared fixed-window limiter for horizontally-scaled cloud instances. The rate
 * key is hashed before storage so Firebase documents never contain a user UID or
 * integration identifier in their path. A transaction makes each increment
 * atomic across concurrent Cloud Run instances.
 */
export class FirestoreCommandRateLimiter implements CommandRateLimiter {
  private readonly db = getCloudFirestore();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(
    limit = Number(process.env.REMOTE_CLOUD_COMMANDS_PER_MINUTE || 30),
    windowMs = 60_000
  ) {
    this.limit = positiveInteger(limit, 30);
    this.windowMs = positiveInteger(windowMs, 60_000);
  }

  async consume(key: string, now: number) {
    const documentId = crypto.createHash('sha256').update(key).digest('hex');
    const ref = this.db.collection('cloudCommandRateLimits').doc(documentId);
    const windowStartedAt = Math.floor(now / this.windowMs) * this.windowMs;

    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data() as Record<string, unknown> | undefined;
      const storedWindow = Number(data?.windowStartedAt ?? -1);
      const count = Number(data?.count ?? 0);

      if (!snapshot.exists || storedWindow !== windowStartedAt) {
        transaction.set(ref, {
          windowStartedAt,
          count: 1,
          updatedAt: FieldValue.serverTimestamp()
        });
        return true;
      }

      if (!Number.isFinite(count) || count >= this.limit) return false;
      transaction.update(ref, {
        count: count + 1,
        updatedAt: FieldValue.serverTimestamp()
      });
      return true;
    });
  }
}

export class FirebaseCloudControlStore implements CloudControlStore {
  private readonly db = getCloudFirestore();

  async listMemberships(uid: string): Promise<InstallationMembership[]> {
    const snapshot = await this.db.collectionGroup('members').where('uid', '==', uid).get();
    const memberships = await Promise.all(snapshot.docs.map(async memberDoc => {
      const installationRef = memberDoc.ref.parent.parent;
      if (!installationRef) return null;
      const memberData = memberDoc.data();
      const memberRole = role(memberData?.role);
      if (!memberRole) return null;
      const memberPermissions = permissions(memberData?.permissions);
      const installation = await installationRef.get();
      return {
        installationId: installationRef.id,
        role: memberRole,
        ...(memberPermissions ? { permissions: memberPermissions } : {}),
        ...(typeof installation.data()?.name === 'string' ? { name: installation.data()!.name } : {})
      } satisfies InstallationMembership;
    }));
    return memberships
      .filter((item): item is InstallationMembership => Boolean(item))
      .sort((a, b) => (a.name || a.installationId).localeCompare(b.name || b.installationId));
  }

  async getMembership(installationId: string, uid: string): Promise<InstallationMembership | null> {
    const installationRef = this.db.collection('installations').doc(installationId);
    const [member, installation] = await Promise.all([
      installationRef.collection('members').doc(uid).get(),
      installationRef.get()
    ]);
    if (!member.exists) return null;
    const memberData = member.data();
    const memberRole = role(memberData?.role);
    if (!memberRole) return null;
    const memberPermissions = permissions(memberData?.permissions);
    return {
      installationId,
      role: memberRole,
      ...(memberPermissions ? { permissions: memberPermissions } : {}),
      ...(typeof installation.data()?.name === 'string' ? { name: installation.data()!.name } : {})
    };
  }

  async getRuntime(installationId: string): Promise<InstallationRuntimeDocument | null> {
    const snapshot = await this.db
      .collection('installations')
      .doc(installationId)
      .collection('runtime')
      .doc('current')
      .get();
    return snapshot.exists ? snapshot.data() as InstallationRuntimeDocument : null;
  }

  async createCommand(command: RemoteCommandEnvelope) {
    const ref = this.db
      .collection('installations')
      .doc(command.installationId)
      .collection('commands')
      .doc(command.commandId);

    await ref.create({
      ...JSON.parse(JSON.stringify(command)),
      status: 'queued',
      createdAtServer: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  }

  async getCommand(installationId: string, commandId: string): Promise<StoredCloudCommand | null> {
    const snapshot = await this.db
      .collection('installations')
      .doc(installationId)
      .collection('commands')
      .doc(commandId)
      .get();

    if (!snapshot.exists) return null;
    const data = snapshot.data() as Record<string, unknown>;
    return {
      commandId,
      installationId,
      type: String(data.type || ''),
      status: String(data.status || ''),
      createdAt: Number(data.createdAt || 0),
      expiresAt: Number(data.expiresAt || 0),
      requestedBy: data.requestedBy,
      payload: data.payload,
      result: data.result
    };
  }
}