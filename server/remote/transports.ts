import type {
  InstallationPresence,
  RemoteCommandEnvelope,
  RemoteCommandResult,
  RemoteInstallationState,
  RemoteTransport,
  RemoteTransportHandlers,
  RemoteTransportStatus
} from './types';

export class NoneRemoteTransport implements RemoteTransport {
  private started = false;

  async start(_handlers: RemoteTransportHandlers) {
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  async publishPresence(_presence: InstallationPresence) {}
  async publishState(_state: RemoteInstallationState) {}
  async acknowledgeCommand(_result: RemoteCommandResult) {}

  getStatus(): RemoteTransportStatus {
    return {
      provider: 'none',
      started: this.started,
      connected: false
    };
  }
}

export class InMemoryRemoteTransport implements RemoteTransport {
  private handlers?: RemoteTransportHandlers;
  private started = false;
  private lastContactAt?: number;
  private lastCommandAt?: number;

  readonly presence: InstallationPresence[] = [];
  readonly states: RemoteInstallationState[] = [];
  readonly acknowledgements: RemoteCommandResult[] = [];

  async start(handlers: RemoteTransportHandlers) {
    this.handlers = handlers;
    this.started = true;
    this.lastContactAt = Date.now();
  }

  async stop() {
    this.handlers = undefined;
    this.started = false;
  }

  async publishPresence(presence: InstallationPresence) {
    this.presence.push(presence);
    this.lastContactAt = Date.now();
  }

  async publishState(state: RemoteInstallationState) {
    this.states.push(state);
    this.lastContactAt = Date.now();
  }

  async acknowledgeCommand(result: RemoteCommandResult) {
    this.acknowledgements.push(result);
    this.lastContactAt = Date.now();
  }

  async deliver(command: RemoteCommandEnvelope) {
    if (!this.started || !this.handlers) throw new Error('In-memory remote transport is not started.');
    this.lastCommandAt = Date.now();
    this.lastContactAt = this.lastCommandAt;
    await this.handlers.onCommand(command);
  }

  getStatus(): RemoteTransportStatus {
    return {
      provider: 'memory',
      started: this.started,
      connected: this.started,
      ...(this.lastContactAt ? { lastContactAt: this.lastContactAt } : {}),
      ...(this.lastCommandAt ? { lastCommandAt: this.lastCommandAt } : {})
    };
  }
}
