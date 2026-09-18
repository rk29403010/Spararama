import { FieldValue } from 'firebase-admin/firestore';
import type { RemoteCommandEnvelope } from '../types';
import type {
  CloudControlStore,
  InstallationMembership,
  InstallationRole,
  InstallationRuntimeDocument,
  StoredCloudCommand
} from './service';
import { getCloudFirestore } from './firebase-admin';

function role(value: unknown): InstallationRole | null {
  return value === 'owner' || value === 'member' || value === 'viewer' ? value : null;
}

export class FirebaseCloudControlStore implements CloudControlStore {
  private readonly db = getCloudFirestore();

  async listMemberships(uid: string): Promise<InstallationMembership[]> {
    const snapshot = await this.db.collectionGroup('members').where('uid', '==', uid).get();
    const memberships = await Promise.all(snapshot.docs.map(async memberDoc => {
      const installationRef = memberDoc.ref.parent.parent;
      if (!installationRef) return null;
      const memberRole = role(memberDoc.data()?.role);
      if (!memberRole) return null;
      const installation = await installationRef.get();
      return {
        installationId: installationRef.id,
        role: memberRole,
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
    const memberRole = role(member.data()?.role);
    if (!memberRole) return null;
    return {
      installationId,
      role: memberRole,
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
