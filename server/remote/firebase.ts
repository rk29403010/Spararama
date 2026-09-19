import os from 'node:os';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
  getFirestore
} from 'firebase-admin/firestore';
import { resolveFirebaseAdminTarget } from '../firebase/admin-config';
import type {
  InstallationPresence,
  RemoteCommandEnvelope,
  RemoteCommandResult,
  RemoteInstallationState,
  RemoteTransport,
  RemoteTransportHandlers,
  RemoteTransportStatus
} from './types';

const REMOTE_APP_NAME = 'spararama-remote';

function serializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export interface FirebaseRemoteTransportOptions {
  installationId: string;
  agentId?: string;
  leaseMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export class FirebaseRemoteTransport implements RemoteTransport {
  private readonly db: Firestore;
  private readonly agentId: string;
  private readonly leaseMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private handlers?: RemoteTransportHandlers;
  private unsubscribe?: () => void;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private started = false;
  private connected = false;
  private stopped = true;
  private lastContactAt?: number;
  private lastCommandAt?: number;
  private lastError?: string;
  private readonly inFlight = new Set<string>();

  constructor(readonly options: FirebaseRemoteTransportOptions) {
    const target = resolveFirebaseAdminTarget();
    const app = getApps().find(candidate => candidate.name === REMOTE_APP_NAME)
      || initializeApp(
        { credential: applicationDefault(), projectId: target.projectId },
        REMOTE_APP_NAME
      );
    this.db = getFirestore(app, target.databaseId);
    this.agentId = options.agentId || process.env.TELEMETRY_HOST_ID || os.hostname();
    this.leaseMs = Math.max(10_000, Number(options.leaseMs || process.env.REMOTE_COMMAND_LEASE_MS || 60_000));
    this.reconnectBaseMs = Math.max(1_000, Number(options.reconnectBaseMs || 2_000));
    this.reconnectMaxMs = Math.max(this.reconnectBaseMs, Number(options.reconnectMaxMs || 60_000));
  }

  async start(handlers: RemoteTransportHandlers) {
    if (this.started) return;
    this.handlers = handlers;
    this.started = true;
    this.stopped = false;
    this.attachListener();
  }

  async stop() {
    this.stopped = true;
    this.started = false;
    this.connected = false;
    this.handlers = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  async publishPresence(presence: InstallationPresence) {
    await this.writeCloud('presence', () => this.runtimeRef().set({
      schemaVersion: 1,
      presence: serializable(presence),
      heartbeatAtMs: Date.now(),
      heartbeatAt: FieldValue.serverTimestamp()
    }, { merge: true }));
  }

  async publishState(state: RemoteInstallationState) {
    await this.writeCloud('state', () => this.runtimeRef().set({
      schemaVersion: 1,
      state: serializable(state),
      statePublishedAtMs: Date.now(),
      statePublishedAt: FieldValue.serverTimestamp()
    }, { merge: true }));
  }

  async acknowledgeCommand(result: RemoteCommandResult) {
    await this.writeCloud('acknowledgement', () => this.commandsRef().doc(result.commandId).set({
      status: result.status,
      result: serializable(result),
      completedAt: result.completedAt,
      updatedAt: FieldValue.serverTimestamp(),
      claimLeaseUntil: FieldValue.delete()
    }, { merge: true }));
  }

  getStatus(): RemoteTransportStatus {
    return {
      provider: 'firebase',
      started: this.started,
      connected: this.connected,
      ...(this.lastContactAt ? { lastContactAt: this.lastContactAt } : {}),
      ...(this.lastCommandAt ? { lastCommandAt: this.lastCommandAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  private commandsRef() {
    return this.db
      .collection('installations')
      .doc(this.options.installationId)
      .collection('commands');
  }

  private runtimeRef() {
    return this.db
      .collection('installations')
      .doc(this.options.installationId)
      .collection('runtime')
      .doc('current');
  }

  private attachListener() {
    if (this.stopped || !this.handlers || this.unsubscribe) return;

    try {
      this.unsubscribe = this.commandsRef().where('status', 'in', ['queued', 'claimed']).onSnapshot(
        snapshot => {
          this.connected = true;
          this.lastError = undefined;
          this.reconnectAttempt = 0;
          this.markContact();
          for (const change of snapshot.docChanges()) {
            if (change.type === 'removed') continue;
            void this.considerDocument(change.doc);
          }
        },
        error => {
          this.connected = false;
          this.lastError = error?.message || String(error);
          this.unsubscribe?.();
          this.unsubscribe = undefined;
          this.scheduleReconnect();
        }
      );
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.unsubscribe = undefined;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * (2 ** Math.min(this.reconnectAttempt, 6))
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.attachListener();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async considerDocument(doc: QueryDocumentSnapshot) {
    if (!this.handlers || this.inFlight.has(doc.id)) return;
    const data = doc.data() as Record<string, any>;
    const status = String(data.status || 'queued');
    if (!['queued', 'claimed'].includes(status)) return;

    const now = Date.now();
    if (status === 'claimed') {
      const leaseUntil = Number(data.claimLeaseUntil || 0);
      const claimedBy = String(data.claimedBy || '');
      if (leaseUntil > now && claimedBy && claimedBy !== this.agentId) return;
    }

    this.inFlight.add(doc.id);
    try {
      const claimed = await this.claim(doc.id, now);
      if (!claimed || !this.handlers) return;

      this.lastCommandAt = Date.now();
      const command = {
        version: data.version,
        commandId: doc.id,
        installationId: data.installationId || this.options.installationId,
        type: data.type,
        payload: data.payload,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        requestedBy: data.requestedBy
      } as RemoteCommandEnvelope;

      await this.handlers.onCommand(command);
      this.markContact();
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      // Do not manufacture a command failure for a transport/network problem.
      // The claim lease will expire; replay is safe because the local executor
      // keeps a durable command-result ledger.
    } finally {
      this.inFlight.delete(doc.id);
    }
  }

  private async claim(commandId: string, now: number) {
    const ref = this.commandsRef().doc(commandId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const data = snapshot.data() as Record<string, any>;
      const status = String(data.status || 'queued');
      if (!['queued', 'claimed'].includes(status)) return false;

      if (status === 'claimed') {
        const leaseUntil = Number(data.claimLeaseUntil || 0);
        const claimedBy = String(data.claimedBy || '');
        if (leaseUntil > now && claimedBy && claimedBy !== this.agentId) return false;
      }

      transaction.set(ref, {
        status: 'claimed',
        claimedBy: this.agentId,
        claimedAt: data.claimedAt || now,
        claimLeaseUntil: now + this.leaseMs,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return true;
    });
  }

  private async writeCloud(label: string, action: () => Promise<unknown>) {
    try {
      await action();
      this.lastError = undefined;
      this.markContact();
    } catch (error) {
      this.connected = false;
      this.lastError = `${label}: ${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }

  private markContact() {
    this.lastContactAt = Date.now();
    this.connected = true;
  }
}
