import type { RemoteCommandExecutor } from './executor';
import type {
  InstallationPresence,
  RemoteInstallationState,
  RemoteTransport,
  RemoteTransportStatus
} from './types';

export interface RemoteAgentStatus extends RemoteTransportStatus {
  installationId: string;
  lastCompletedCommandAt?: number;
  lastCompletedCommandId?: string;
}

export class RemoteAgent {
  private started = false;
  private lastCompletedCommandAt?: number;
  private lastCompletedCommandId?: string;
  private commandCompletedHandler?: (result: import('./types').RemoteCommandResult) => Promise<void> | void;

  constructor(
    readonly installationId: string,
    private readonly transport: RemoteTransport,
    private readonly executor: RemoteCommandExecutor
  ) {}

  async start() {
    if (this.started) return;
    await this.transport.start({
      onCommand: async command => {
        const result = await this.executor.execute(command);
        await this.transport.acknowledgeCommand(result);
        this.lastCompletedCommandAt = result.completedAt;
        this.lastCompletedCommandId = result.commandId;
        if (this.commandCompletedHandler) {
          try {
            await this.commandCompletedHandler(result);
          } catch {
            // State publication is best effort; command acknowledgement has already completed.
          }
        }
      }
    });
    this.started = true;
  }

  async stop() {
    if (!this.started) return;
    await this.transport.stop();
    this.started = false;
  }

  setCommandCompletedHandler(handler: (result: import('./types').RemoteCommandResult) => Promise<void> | void) {
    this.commandCompletedHandler = handler;
  }

  publishPresence(presence: Omit<InstallationPresence, 'installationId'>) {
    return this.transport.publishPresence({
      ...presence,
      installationId: this.installationId
    });
  }

  publishState(state: Omit<RemoteInstallationState, 'installationId'>) {
    return this.transport.publishState({
      ...state,
      installationId: this.installationId
    });
  }

  getStatus(): RemoteAgentStatus {
    return {
      ...this.transport.getStatus(),
      installationId: this.installationId,
      ...(this.lastCompletedCommandAt ? { lastCompletedCommandAt: this.lastCompletedCommandAt } : {}),
      ...(this.lastCompletedCommandId ? { lastCompletedCommandId: this.lastCompletedCommandId } : {})
    };
  }
}
