import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getCloudFirestore } from '../remote/cloud/firebase-admin';
import type { CloudPrincipal, InstallationRole } from '../remote/cloud/service';
import {
  defaultPermissionsForRole,
  normalizePermissions,
  roleForPermissions,
  type InstallationAccess,
  type InstallationPermission
} from './permissions';

export interface ManagedInstallationUser extends InstallationAccess {
  uid: string;
  email?: string;
  displayName?: string;
  invitedEmail?: string;
  joinedAt?: number;
}

export interface ManagedInvite {
  id: string;
  email: string;
  permissions: InstallationPermission[];
  createdAt: number;
  expiresAt: number;
  createdByUid: string;
}

export interface CreatedInvite extends ManagedInvite {
  token: string;
}

function role(value: unknown): InstallationRole | null {
  return value === 'owner' || value === 'member' || value === 'viewer' ? value : null;
}

function millis(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const timestamp = value as { toMillis?: () => number } | undefined;
  if (typeof timestamp?.toMillis === 'function') return timestamp.toMillis();
  return undefined;
}

function hashToken(secret: string) {
  return crypto.createHash('sha256').update(secret).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export class FirebaseInstallationAccessStore {
  private readonly db = getCloudFirestore();

  async getAccess(installationId: string, uid: string): Promise<InstallationAccess | null> {
    const snapshot = await this.db.collection('installations').doc(installationId).collection('members').doc(uid).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    const memberRole = role(data.role);
    if (!memberRole) return null;
    return {
      role: memberRole,
      permissions: normalizePermissions(data.permissions, memberRole)
    };
  }

  async listUsers(installationId: string): Promise<ManagedInstallationUser[]> {
    const snapshot = await this.db.collection('installations').doc(installationId).collection('members').get();
    return snapshot.docs.flatMap(document => {
      const data = document.data() || {};
      const memberRole = role(data.role);
      if (!memberRole) return [];
      return [{
        uid: document.id,
        role: memberRole,
        permissions: normalizePermissions(data.permissions, memberRole),
        ...(typeof data.email === 'string' && data.email ? { email: data.email } : {}),
        ...(typeof data.displayName === 'string' && data.displayName ? { displayName: data.displayName } : {}),
        ...(typeof data.invitedEmail === 'string' && data.invitedEmail ? { invitedEmail: data.invitedEmail } : {}),
        ...(millis(data.joinedAt) !== undefined ? { joinedAt: millis(data.joinedAt) } : {})
      }];
    }).sort((a, b) => (a.displayName || a.email || a.uid).localeCompare(b.displayName || b.email || b.uid));
  }

  async listInvites(installationId: string, now = Date.now()): Promise<ManagedInvite[]> {
    const snapshot = await this.db.collection('installations').doc(installationId).collection('invites').get();
    return snapshot.docs.flatMap(document => {
      const data = document.data() || {};
      const expiresAt = Number(data.expiresAt || 0);
      if (data.claimedAt || data.revokedAt || !Number.isFinite(expiresAt) || expiresAt <= now) return [];
      const inviteRole = role(data.role) || 'viewer';
      return [{
        id: document.id,
        email: typeof data.email === 'string' ? data.email : '',
        permissions: normalizePermissions(data.permissions, inviteRole),
        createdAt: Number(data.createdAt || 0),
        expiresAt,
        createdByUid: typeof data.createdByUid === 'string' ? data.createdByUid : ''
      }];
    }).sort((a, b) => b.createdAt - a.createdAt);
  }

  async createInvite(
    installationId: string,
    email: string,
    permissions: InstallationPermission[],
    createdByUid: string,
    now = Date.now(),
    ttlMs = 7 * 24 * 60 * 60 * 1000
  ): Promise<CreatedInvite> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) throw new Error('Enter a valid email address.');
    const id = crypto.randomBytes(12).toString('base64url');
    const secret = crypto.randomBytes(32).toString('base64url');
    const token = `${id}.${secret}`;
    const accessRole = roleForPermissions(permissions);
    const expiresAt = now + ttlMs;
    await this.db.collection('installations').doc(installationId).collection('invites').doc(id).create({
      email: normalizedEmail,
      role: accessRole,
      permissions,
      tokenHash: hashToken(secret),
      createdAt: now,
      expiresAt,
      createdByUid,
      createdAtServer: FieldValue.serverTimestamp()
    });
    return { id, email: normalizedEmail, role: accessRole, permissions, createdAt: now, expiresAt, createdByUid, token };
  }

  async claimInvite(
    installationId: string,
    token: string,
    principal: CloudPrincipal & { displayName?: string },
    now = Date.now()
  ): Promise<InstallationAccess> {
    const [id, secret, extra] = String(token || '').split('.');
    if (!id || !secret || extra !== undefined) throw new Error('This invite link is not valid.');
    const inviteRef = this.db.collection('installations').doc(installationId).collection('invites').doc(id);
    const memberRef = this.db.collection('installations').doc(installationId).collection('members').doc(principal.uid);

    return this.db.runTransaction(async transaction => {
      const invite = await transaction.get(inviteRef);
      if (!invite.exists) throw new Error('This invite link is not valid.');
      const data = invite.data() || {};
      if (data.claimedAt || data.revokedAt) throw new Error('This invite has already been used or revoked.');
      const expiresAt = Number(data.expiresAt || 0);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('This invite has expired.');
      if (typeof data.tokenHash !== 'string' || !safeEqual(data.tokenHash, hashToken(secret))) {
        throw new Error('This invite link is not valid.');
      }
      const inviteRole = role(data.role) || 'viewer';
      const permissions = normalizePermissions(data.permissions, inviteRole);
      const accessRole = roleForPermissions(permissions);
      transaction.set(memberRef, {
        uid: principal.uid,
        role: accessRole,
        permissions,
        ...(principal.email ? { email: principal.email } : {}),
        ...(principal.displayName ? { displayName: principal.displayName } : {}),
        ...(typeof data.email === 'string' ? { invitedEmail: data.email } : {}),
        joinedAt: now,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.update(inviteRef, {
        claimedAt: now,
        claimedByUid: principal.uid,
        updatedAt: FieldValue.serverTimestamp()
      });
      return { role: accessRole, permissions };
    });
  }

  async updateUser(
    installationId: string,
    uid: string,
    permissions: InstallationPermission[]
  ): Promise<InstallationAccess> {
    const accessRole = roleForPermissions(permissions);
    const ref = this.db.collection('installations').doc(installationId).collection('members').doc(uid);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('User not found.');
    await ref.update({ role: accessRole, permissions, updatedAt: FieldValue.serverTimestamp() });
    return { role: accessRole, permissions };
  }

  async removeUser(installationId: string, uid: string) {
    await this.db.collection('installations').doc(installationId).collection('members').doc(uid).delete();
  }

  async revokeInvite(installationId: string, inviteId: string, now = Date.now()) {
    await this.db.collection('installations').doc(installationId).collection('invites').doc(inviteId).set({
      revokedAt: now,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async ensureAtLeastOneAdmin(installationId: string, excludingUid?: string) {
    const users = await this.listUsers(installationId);
    return users.some(user => user.uid !== excludingUid && user.permissions.includes('user_admin'));
  }

  defaultPermissions(roleValue: InstallationRole) {
    return defaultPermissionsForRole(roleValue);
  }
}
