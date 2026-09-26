import type { Express, Request, Response } from 'express';
import type { LocalControlSecurity } from './local-control';
import { FirebaseInstallationAccessStore } from './access-store';
import {
  INSTALLATION_PERMISSIONS,
  type InstallationPermission
} from './permissions';

function installationId() {
  return String(process.env.REMOTE_INSTALLATION_ID || '').trim();
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: any) => {
      console.warn(`User management failed: ${error?.message || String(error)}`);
      res.status(500).json({ error: error?.message || 'User management failed.' });
    });
  };
}

function requestedPermissions(value: unknown): InstallationPermission[] {
  if (!Array.isArray(value)) return [];
  return INSTALLATION_PERMISSIONS.filter(permission => value.includes(permission));
}

function requireInstallation(res: Response) {
  const id = installationId();
  if (!id) {
    res.status(503).json({
      error: 'This Spararama instance does not have REMOTE_INSTALLATION_ID configured.',
      code: 'installation_not_configured'
    });
    return null;
  }
  return id;
}

export function registerUserManagementRoutes(
  app: Express,
  security: LocalControlSecurity,
  store = new FirebaseInstallationAccessStore()
) {
  app.get('/api/access/me', asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { principal, access } = await security.authenticateBearer(req.headers.authorization);
    res.json({
      authorized: Boolean(access),
      uid: principal.uid,
      ...(principal.email ? { email: principal.email } : {}),
      role: access?.role ?? null,
      permissions: access?.permissions ?? []
    });
  }));

  app.post('/api/access/invites/claim', asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = requireInstallation(res);
    if (!id) return;
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      res.status(400).json({ error: 'Invite token is required.' });
      return;
    }
    const { principal } = await security.authenticateBearer(req.headers.authorization);
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim().slice(0, 120) : '';
    const access = await store.claimInvite(id, token, { ...principal, ...(displayName ? { displayName } : {}) });
    security.invalidateSessions(principal.uid);
    res.json({ authorized: true, uid: principal.uid, role: access.role, permissions: access.permissions });
  }));

  const requireAdmin = security.requireBearerPermission('user_admin');

  app.get('/api/access/users', requireAdmin, asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = requireInstallation(res);
    if (!id) return;
    const [users, invites] = await Promise.all([store.listUsers(id), store.listInvites(id)]);
    res.json({ users, invites, permissions: INSTALLATION_PERMISSIONS });
  }));

  app.post('/api/access/invites', requireAdmin, asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = requireInstallation(res);
    if (!id) return;
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const permissions = requestedPermissions(req.body?.permissions);
    const invite = await store.createInvite(id, email, permissions, String(res.locals.localControlUid || ''));
    res.status(201).json(invite);
  }));

  app.patch('/api/access/users/:uid', requireAdmin, asyncRoute(async (req, res) => {
    const id = requireInstallation(res);
    if (!id) return;
    const uid = String(req.params.uid || '').trim();
    if (!uid) {
      res.status(400).json({ error: 'User ID is required.' });
      return;
    }
    const permissions = requestedPermissions(req.body?.permissions);
    if (uid === res.locals.localControlUid && !permissions.includes('user_admin')) {
      res.status(409).json({ error: 'You cannot remove your own user-management permission.' });
      return;
    }
    const access = await store.updateUser(id, uid, permissions);
    security.invalidateSessions(uid);
    res.json({ uid, ...access });
  }));

  app.delete('/api/access/users/:uid', requireAdmin, asyncRoute(async (req, res) => {
    const id = requireInstallation(res);
    if (!id) return;
    const uid = String(req.params.uid || '').trim();
    if (uid === res.locals.localControlUid) {
      res.status(409).json({ error: 'You cannot remove your own account.' });
      return;
    }
    await store.removeUser(id, uid);
    security.invalidateSessions(uid);
    res.status(204).end();
  }));

  app.delete('/api/access/invites/:inviteId', requireAdmin, asyncRoute(async (req, res) => {
    const id = requireInstallation(res);
    if (!id) return;
    await store.revokeInvite(id, String(req.params.inviteId || ''));
    res.status(204).end();
  }));
}
