import type { User } from 'firebase/auth';

export type InstallationPermission = 'spa_control' | 'heating_manage' | 'water_testing' | 'user_admin';
export type InstallationRole = 'owner' | 'member' | 'viewer';

export interface UserAccess {
  authorized: boolean;
  uid: string;
  email?: string;
  role: InstallationRole | null;
  permissions: InstallationPermission[];
}

export interface ManagedUser {
  uid: string;
  email?: string;
  displayName?: string;
  invitedEmail?: string;
  role: InstallationRole;
  permissions: InstallationPermission[];
  joinedAt?: number;
}

export interface ManagedInvite {
  id: string;
  email: string;
  role: InstallationRole;
  permissions: InstallationPermission[];
  createdAt: number;
  expiresAt: number;
  createdByUid: string;
}

export interface CreatedInvite extends ManagedInvite {
  token: string;
}

export interface UserManagementSnapshot {
  users: ManagedUser[];
  invites: ManagedInvite[];
  permissions: InstallationPermission[];
}

async function authHeaders(user: User, json = false) {
  const token = await user.getIdToken();
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : fallback);
  return body as T;
}

export const accessApi = {
  async me(user: User) {
    const response = await fetch('/api/access/me', {
      headers: await authHeaders(user),
      credentials: 'same-origin'
    });
    return parseResponse<UserAccess>(response, 'Could not check Spararama access.');
  },

  async claimInvite(user: User, token: string) {
    const response = await fetch('/api/access/invites/claim', {
      method: 'POST',
      headers: await authHeaders(user, true),
      credentials: 'same-origin',
      body: JSON.stringify({ token, displayName: user.displayName || '' })
    });
    return parseResponse<UserAccess>(response, 'Could not accept this Spararama invite.');
  },

  async listUsers(user: User) {
    const response = await fetch('/api/access/users', {
      headers: await authHeaders(user),
      credentials: 'same-origin'
    });
    return parseResponse<UserManagementSnapshot>(response, 'Could not load Spararama users.');
  },

  async createInvite(user: User, email: string, permissions: InstallationPermission[]) {
    const response = await fetch('/api/access/invites', {
      method: 'POST',
      headers: await authHeaders(user, true),
      credentials: 'same-origin',
      body: JSON.stringify({ email, permissions })
    });
    return parseResponse<CreatedInvite>(response, 'Could not create the invite.');
  },

  async updateUser(user: User, uid: string, permissions: InstallationPermission[]) {
    const response = await fetch(`/api/access/users/${encodeURIComponent(uid)}`, {
      method: 'PATCH',
      headers: await authHeaders(user, true),
      credentials: 'same-origin',
      body: JSON.stringify({ permissions })
    });
    return parseResponse<{ uid: string; role: InstallationRole; permissions: InstallationPermission[] }>(response, 'Could not update the user.');
  },

  async removeUser(user: User, uid: string) {
    const response = await fetch(`/api/access/users/${encodeURIComponent(uid)}`, {
      method: 'DELETE',
      headers: await authHeaders(user),
      credentials: 'same-origin'
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body?.error === 'string' ? body.error : 'Could not remove the user.');
    }
  },

  async revokeInvite(user: User, inviteId: string) {
    const response = await fetch(`/api/access/invites/${encodeURIComponent(inviteId)}`, {
      method: 'DELETE',
      headers: await authHeaders(user),
      credentials: 'same-origin'
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body?.error === 'string' ? body.error : 'Could not revoke the invite.');
    }
  }
};
