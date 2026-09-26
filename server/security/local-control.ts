import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { FirebaseCloudAuthenticator, type CloudAuthenticator } from '../remote/cloud/firebase-auth';
import type { CloudControlStore, CloudPrincipal, InstallationRole } from '../remote/cloud/service';
import { FirebaseInstallationAccessStore } from './access-store';
import {
  defaultPermissionsForRole,
  hasPermission,
  normalizePermissions,
  type InstallationAccess,
  type InstallationPermission
} from './permissions';

const SESSION_COOKIE = 'spararama_local_control';
const SESSION_VERSION = 2;
const DEFAULT_SESSION_HOURS = 24 * 30;

export interface LocalControlSession {
  v: 2;
  uid: string;
  email?: string;
  role: InstallationRole;
  permissions: InstallationPermission[];
  generation: string;
  issuedAt: number;
  expiresAt: number;
}

export interface LocalControlSecurityOptions {
  secret?: Buffer;
  now?: () => number;
  sessionTtlMs?: number;
  authenticator?: CloudAuthenticator;
  membershipStore?: Pick<CloudControlStore, 'getMembership'>;
  accessStore?: Pick<FirebaseInstallationAccessStore, 'getAccess'>;
}

function parseList(value: string | undefined, lowerCase = false) {
  const items = String(value || '')
    .split(/[\s,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return new Set(lowerCase ? items.map(item => item.toLowerCase()) : items);
}

function matchesPrincipal(
  principal: CloudPrincipal,
  uidVariable: string,
  emailVariable: string,
  includeAdminFallback = false
) {
  const uids = parseList(process.env[uidVariable]);
  const emails = parseList(process.env[emailVariable], true);
  if (includeAdminFallback) {
    for (const uid of parseList(process.env.SPARARAMA_ADMIN_UID)) uids.add(uid);
    for (const email of parseList(process.env.SPARARAMA_ADMIN_EMAILS, true)) emails.add(email);
  }
  return uids.has(principal.uid)
    || Boolean(principal.email && emails.has(principal.email.toLowerCase()));
}

export function explicitLocalControlRole(principal: CloudPrincipal): InstallationRole | null {
  if (matchesPrincipal(
    principal,
    'SPAR_LOCAL_CONTROL_OWNER_UIDS',
    'SPAR_LOCAL_CONTROL_OWNER_EMAILS',
    true
  )) return 'owner';
  if (matchesPrincipal(
    principal,
    'SPAR_LOCAL_CONTROL_MEMBER_UIDS',
    'SPAR_LOCAL_CONTROL_MEMBER_EMAILS'
  )) return 'member';
  if (matchesPrincipal(
    principal,
    'SPAR_LOCAL_CONTROL_VIEWER_UIDS',
    'SPAR_LOCAL_CONTROL_VIEWER_EMAILS'
  )) return 'viewer';
  return null;
}

export function isLoopbackAddress(address: string | undefined | null) {
  const normalized = String(address || '').toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

function hasProxyIdentityHeaders(req: Request) {
  return Boolean(
    req.headers.forwarded
    || req.headers['x-forwarded-for']
    || req.headers['x-real-ip']
  );
}

export function isDirectLoopbackRequest(req: Request) {
  return isLoopbackAddress(req.socket.remoteAddress) && !hasProxyIdentityHeaders(req);
}

function isSecureRequest(req: Request) {
  if (Boolean((req.socket as Request['socket'] & { encrypted?: boolean }).encrypted)) return true;
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return forwardedProto === 'https';
}

function readCookie(req: Request, name: string) {
  const cookie = String(req.headers.cookie || '');
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function authDirectory() {
  return process.env.SPAR_LOCAL_AUTH_DIR || path.join(process.cwd(), 'data', 'local-auth');
}

function readOrCreateSecret() {
  const directory = authDirectory();
  const secretPath = path.join(directory, 'session-secret');
  fs.mkdirSync(directory, { recursive: true });

  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    const decoded = Buffer.from(existing, 'base64url');
    if (decoded.length < 32) throw new Error('Local-control session secret is too short.');
    return decoded;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const secret = crypto.randomBytes(32);
  const temporaryPath = `${secretPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, secret.toString('base64url'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporaryPath, secretPath);
  try {
    fs.chmodSync(secretPath, 0o600);
  } catch {
    // Some host filesystems do not implement POSIX modes. The file remains under
    // the application's private data directory and is never returned to clients.
  }
  return secret;
}

function role(value: unknown): InstallationRole | null {
  return value === 'owner' || value === 'member' || value === 'viewer' ? value : null;
}

export class LocalControlSessionCodec {
  constructor(
    private readonly secret: Buffer,
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = DEFAULT_SESSION_HOURS * 60 * 60 * 1000
  ) {}

  issue(
    principal: CloudPrincipal,
    accessRole: InstallationRole,
    permissions: InstallationPermission[] = defaultPermissionsForRole(accessRole),
    generation = 'standalone'
  ) {
    const issuedAt = this.now();
    const payload: LocalControlSession = {
      v: SESSION_VERSION,
      uid: principal.uid,
      ...(principal.email ? { email: principal.email } : {}),
      role: accessRole,
      permissions: normalizePermissions(permissions, accessRole),
      generation,
      issuedAt,
      expiresAt: issuedAt + this.ttlMs
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${this.signature(encoded)}`;
  }

  verify(token: string): LocalControlSession | null {
    const [encoded, suppliedSignature, extra] = String(token || '').split('.');
    if (!encoded || !suppliedSignature || extra !== undefined) return null;

    const expectedSignature = this.signature(encoded);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<LocalControlSession>;
      const accessRole = role(payload.role);
      if (
        payload.v !== SESSION_VERSION
        || typeof payload.uid !== 'string'
        || !payload.uid
        || !accessRole
        || typeof payload.generation !== 'string'
        || !payload.generation
        || typeof payload.issuedAt !== 'number'
        || typeof payload.expiresAt !== 'number'
        || payload.expiresAt <= this.now()
        || payload.expiresAt <= payload.issuedAt
      ) return null;
      return {
        ...payload,
        role: accessRole,
        permissions: normalizePermissions(payload.permissions, accessRole)
      } as LocalControlSession;
    } catch {
      return null;
    }
  }

  private signature(encoded: string) {
    return crypto.createHmac('sha256', this.secret).update(encoded).digest('base64url');
  }
}

export class LocalControlSecurity {
  private readonly now: () => number;
  private readonly codec: LocalControlSessionCodec;
  private authenticator?: CloudAuthenticator;
  private accessStore?: Pick<FirebaseInstallationAccessStore, 'getAccess'>;

  constructor(private readonly options: LocalControlSecurityOptions = {}) {
    this.now = options.now || (() => Date.now());
    const configuredHours = Number(process.env.SPAR_LOCAL_CONTROL_SESSION_HOURS || DEFAULT_SESSION_HOURS);
    const ttlMs = options.sessionTtlMs
      ?? Math.max(1, Number.isFinite(configuredHours) ? configuredHours : DEFAULT_SESSION_HOURS) * 60 * 60 * 1000;
    this.codec = new LocalControlSessionCodec(options.secret || readOrCreateSecret(), this.now, ttlMs);
    this.authenticator = options.authenticator;
    this.accessStore = options.accessStore;
  }

  registerRoutes(app: Express) {
    app.post('/api/local-auth/session', (req, res) => {
      void this.createSession(req, res);
    });
  }

  readonly protectPhysicalControl: RequestHandler = (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    this.authorizeLocalSession(req, res, next, 'spa_control');
  };

  readonly protectHeatingManagement: RequestHandler = (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    this.authorizeLocalSession(req, res, next, 'heating_manage');
  };

  /** Protect an authenticated local operation that can change state or incur cost. */
  readonly protectAuthenticatedOperation: RequestHandler = (req, res, next) => {
    this.authorizeLocalSession(req, res, next, 'spa_control');
  };

  requireBearerRole(allowedRoles: readonly InstallationRole[]): RequestHandler {
    return (req, res, next) => {
      void this.authorizeBearerRequest(req, res, next, access => allowedRoles.includes(access.role));
    };
  }

  requireBearerPermission(permission: InstallationPermission): RequestHandler {
    return (req, res, next) => {
      void this.authorizeBearerRequest(req, res, next, access => hasPermission(access, permission));
    };
  }

  async authenticateBearer(authorization: string | undefined) {
    const principal = await this.getAuthenticator().authenticateAuthorizationHeader(authorization);
    const access = await this.resolveAccess(principal);
    return { principal, access };
  }

  /** Invalidate every issued local-control cookie for a user immediately. */
  invalidateSessions(uid: string) {
    if (!uid) return;
    const generations = this.readSessionGenerations();
    generations[uid] = crypto.randomBytes(18).toString('base64url');
    this.writeSessionGenerations(generations);
  }

  private authorizeLocalSession(
    req: Request,
    res: Response,
    next: NextFunction,
    requiredPermission: InstallationPermission
  ) {
    // A direct process-local request remains the explicit offline/recovery trust
    // boundary. Reverse-proxied requests carry forwarding headers and never get it.
    if (isDirectLoopbackRequest(req)) {
      res.locals.localControlRole = 'owner';
      res.locals.localControlPermissions = defaultPermissionsForRole('owner');
      next();
      return;
    }

    if (process.env.SPAR_LOCAL_CONTROL_ALLOW_INSECURE_HTTP !== '1' && !isSecureRequest(req)) {
      res.status(403).json({
        error: 'LAN access to protected Spararama operations requires HTTPS.',
        code: 'secure_transport_required'
      });
      return;
    }

    const session = this.codec.verify(readCookie(req, SESSION_COOKIE));
    if (!session || session.generation !== this.sessionGeneration(session.uid)) {
      res.status(401).json({
        error: 'Sign in to use protected Spararama operations from another device.',
        code: 'local_auth_required'
      });
      return;
    }
    if (!session.permissions.includes(requiredPermission)) {
      res.status(403).json({
        error: 'This account does not have permission for that action.',
        code: 'missing_permission',
        permission: requiredPermission
      });
      return;
    }

    res.locals.localControlRole = session.role;
    res.locals.localControlPermissions = session.permissions;
    res.locals.localControlUid = session.uid;
    next();
  }

  private async authorizeBearerRequest(
    req: Request,
    res: Response,
    next: NextFunction,
    allowed: (access: InstallationAccess) => boolean
  ) {
    try {
      const { principal, access } = await this.authenticateBearer(req.headers.authorization);
      if (!access || !allowed(access)) {
        res.status(403).json({
          error: 'This account is not authorised for this Spararama administration operation.',
          code: 'insufficient_role'
        });
        return;
      }
      res.locals.localControlRole = access.role;
      res.locals.localControlPermissions = access.permissions;
      res.locals.localControlUid = principal.uid;
      next();
    } catch (error: any) {
      const status = Number(error?.statusCode || 0);
      if (status === 401 || status === 403) {
        res.status(status).json({
          error: error?.message || 'Sign-in could not be verified.',
          code: error?.code || 'local_auth_failed'
        });
        return;
      }
      console.warn(`Spararama role authentication failed: ${error?.message || String(error)}`);
      res.status(503).json({
        error: 'Spararama role authentication is temporarily unavailable.',
        code: 'local_auth_unavailable'
      });
    }
  }

  private async createSession(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (!isDirectLoopbackRequest(req)
      && process.env.SPAR_LOCAL_CONTROL_ALLOW_INSECURE_HTTP !== '1'
      && !isSecureRequest(req)) {
      res.status(403).json({
        error: 'LAN spa control authentication requires HTTPS.',
        code: 'secure_transport_required'
      });
      return;
    }

    try {
      const { principal, access } = await this.authenticateBearer(req.headers.authorization);
      if (!access) {
        res.status(403).json({
          error: 'This signed-in account is not authorised for this Spararama installation.',
          code: 'local_control_forbidden'
        });
        return;
      }

      const token = this.codec.issue(principal, access.role, access.permissions, this.sessionGeneration(principal.uid));
      const session = this.codec.verify(token)!;
      const maxAgeSeconds = Math.max(1, Math.floor((session.expiresAt - this.now()) / 1000));
      const attributes = [
        `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        'Path=/api',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${maxAgeSeconds}`
      ];
      if (isSecureRequest(req)) attributes.push('Secure');
      res.setHeader('Set-Cookie', attributes.join('; '));
      res.json({ role: access.role, permissions: access.permissions, expiresAt: session.expiresAt });
    } catch (error: any) {
      const status = Number(error?.statusCode || 0);
      if (status === 401 || status === 403) {
        res.status(status).json({
          error: error?.message || 'Sign-in could not be verified.',
          code: error?.code || 'local_auth_failed'
        });
        return;
      }
      console.warn(`Local-control authentication failed: ${error?.message || String(error)}`);
      res.status(503).json({
        error: 'Local-control authentication is temporarily unavailable.',
        code: 'local_auth_unavailable'
      });
    }
  }

  private getAuthenticator() {
    if (!this.authenticator) this.authenticator = new FirebaseCloudAuthenticator();
    return this.authenticator;
  }

  private getAccessStore() {
    if (!this.accessStore) this.accessStore = new FirebaseInstallationAccessStore();
    return this.accessStore;
  }

  private sessionGenerationsPath() {
    return path.join(authDirectory(), 'session-generations.json');
  }

  private readSessionGenerations(): Record<string, string> {
    try {
      const value = JSON.parse(fs.readFileSync(this.sessionGenerationsPath(), 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error: any) {
      if (error?.code === 'ENOENT') return {};
      console.warn(`Could not read session generations: ${error?.message || String(error)}`);
      return {};
    }
  }

  private writeSessionGenerations(generations: Record<string, string>) {
    const directory = authDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const target = this.sessionGenerationsPath();
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(generations, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
  }

  private sessionGeneration(uid: string) {
    const generations = this.readSessionGenerations();
    const existing = generations[uid];
    if (typeof existing === 'string' && existing) return existing;
    const generated = crypto.randomBytes(18).toString('base64url');
    generations[uid] = generated;
    this.writeSessionGenerations(generations);
    return generated;
  }

  private async resolveAccess(principal: CloudPrincipal): Promise<InstallationAccess | null> {
    const explicit = explicitLocalControlRole(principal);
    if (explicit) return { role: explicit, permissions: defaultPermissionsForRole(explicit) };

    const installationId = String(process.env.REMOTE_INSTALLATION_ID || '').trim();
    if (!installationId) return null;

    // Tests and older integrations can still inject the coarse role-only store.
    if (this.options.membershipStore) {
      const membership = await this.options.membershipStore.getMembership(installationId, principal.uid);
      return membership ? { role: membership.role, permissions: defaultPermissionsForRole(membership.role) } : null;
    }
    return this.getAccessStore().getAccess(installationId, principal.uid);
  }
}

export function registerLocalControlSecurity(app: Express, security = new LocalControlSecurity()) {
  security.registerRoutes(app);
  app.use('/api/spa', security.protectPhysicalControl);
  app.use('/api/heating/schedules', security.protectHeatingManagement);
  return security;
}
