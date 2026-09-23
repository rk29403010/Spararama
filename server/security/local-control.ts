import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { FirebaseCloudAuthenticator, type CloudAuthenticator } from '../remote/cloud/firebase-auth';
import { FirebaseCloudControlStore } from '../remote/cloud/firebase-store';
import type { CloudControlStore, CloudPrincipal, InstallationRole } from '../remote/cloud/service';

const SESSION_COOKIE = 'spararama_local_control';
const SESSION_VERSION = 1;
const DEFAULT_SESSION_HOURS = 24 * 30;

export interface LocalControlSession {
  v: 1;
  uid: string;
  email?: string;
  role: InstallationRole;
  issuedAt: number;
  expiresAt: number;
}

export interface LocalControlSecurityOptions {
  secret?: Buffer;
  now?: () => number;
  sessionTtlMs?: number;
  authenticator?: CloudAuthenticator;
  membershipStore?: Pick<CloudControlStore, 'getMembership'>;
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

  issue(principal: CloudPrincipal, accessRole: InstallationRole) {
    const issuedAt = this.now();
    const payload: LocalControlSession = {
      v: SESSION_VERSION,
      uid: principal.uid,
      ...(principal.email ? { email: principal.email } : {}),
      role: accessRole,
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
        || typeof payload.issuedAt !== 'number'
        || typeof payload.expiresAt !== 'number'
        || payload.expiresAt <= this.now()
        || payload.expiresAt <= payload.issuedAt
      ) return null;
      return { ...payload, role: accessRole } as LocalControlSession;
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
  private membershipStore?: Pick<CloudControlStore, 'getMembership'>;

  constructor(private readonly options: LocalControlSecurityOptions = {}) {
    this.now = options.now || (() => Date.now());
    const configuredHours = Number(process.env.SPAR_LOCAL_CONTROL_SESSION_HOURS || DEFAULT_SESSION_HOURS);
    const ttlMs = options.sessionTtlMs
      ?? Math.max(1, Number.isFinite(configuredHours) ? configuredHours : DEFAULT_SESSION_HOURS) * 60 * 60 * 1000;
    this.codec = new LocalControlSessionCodec(options.secret || readOrCreateSecret(), this.now, ttlMs);
    this.authenticator = options.authenticator;
    this.membershipStore = options.membershipStore;
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

    // A process reachable only through the local host is an explicit trusted
    // boundary and remains the offline/recovery path. Requests arriving through
    // a reverse proxy carry forwarding headers and are never treated as loopback.
    if (isDirectLoopbackRequest(req)) {
      res.locals.localControlRole = 'owner';
      next();
      return;
    }

    if (process.env.SPAR_LOCAL_CONTROL_ALLOW_INSECURE_HTTP !== '1' && !isSecureRequest(req)) {
      res.status(403).json({
        error: 'LAN spa control requires HTTPS.',
        code: 'secure_transport_required'
      });
      return;
    }

    const session = this.codec.verify(readCookie(req, SESSION_COOKIE));
    if (!session) {
      res.status(401).json({
        error: 'Sign in to control the spa from another device.',
        code: 'local_auth_required'
      });
      return;
    }
    if (session.role === 'viewer') {
      res.status(403).json({
        error: 'This account has read-only access to the spa.',
        code: 'read_only'
      });
      return;
    }

    res.locals.localControlRole = session.role;
    res.locals.localControlUid = session.uid;
    next();
  };

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
      const principal = await this.getAuthenticator().authenticateAuthorizationHeader(req.headers.authorization);
      const accessRole = await this.resolveRole(principal);
      if (!accessRole) {
        res.status(403).json({
          error: 'This signed-in account is not authorised for local spa control.',
          code: 'local_control_forbidden'
        });
        return;
      }

      const token = this.codec.issue(principal, accessRole);
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
      res.json({ role: accessRole, expiresAt: session.expiresAt });
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

  private getMembershipStore() {
    if (!this.membershipStore) this.membershipStore = new FirebaseCloudControlStore();
    return this.membershipStore;
  }

  private async resolveRole(principal: CloudPrincipal): Promise<InstallationRole | null> {
    const explicit = explicitLocalControlRole(principal);
    if (explicit) return explicit;

    const installationId = String(process.env.REMOTE_INSTALLATION_ID || '').trim();
    if (!installationId) return null;
    const membership = await this.getMembershipStore().getMembership(installationId, principal.uid);
    return membership?.role || null;
  }
}

export function registerLocalControlSecurity(app: Express, security = new LocalControlSecurity()) {
  security.registerRoutes(app);
  app.use('/api/spa', security.protectPhysicalControl);
  app.use('/api/heating/schedules', security.protectPhysicalControl);
  return security;
}
