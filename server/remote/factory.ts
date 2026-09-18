import path from 'node:path';
import type { BubbleSessionManager } from '../spa/bubbles';
import type { SpaAdapter } from '../spa/types';
import type { HeatingScheduler } from '../heating/scheduler';
import { RemoteAgent } from './agent';
import { RemoteCommandExecutor } from './executor';
import { FileRemoteCommandLedger } from './ledger';
import { NoneRemoteTransport } from './transports';

export interface RemoteRuntimeConfig {
  transport: 'none';
  configuredTransport: string;
  installationId: string;
  stateDir: string;
  warning?: string;
}

export interface RemoteRuntime {
  config: RemoteRuntimeConfig;
  agent: RemoteAgent;
}

export function resolveRemoteRuntimeConfig(): RemoteRuntimeConfig {
  const configuredTransport = String(process.env.REMOTE_TRANSPORT || 'none').trim().toLowerCase() || 'none';
  const installationId = String(process.env.REMOTE_INSTALLATION_ID || '').trim() || 'local-disabled';
  const stateDir = process.env.REMOTE_STATE_DIR || path.join(process.cwd(), 'data', 'remote');

  if (configuredTransport !== 'none') {
    return {
      transport: 'none',
      configuredTransport,
      installationId,
      stateDir,
      warning: `REMOTE_TRANSPORT=${configuredTransport} is not implemented yet; remote control remains disabled.`
    };
  }

  return {
    transport: 'none',
    configuredTransport,
    installationId,
    stateDir
  };
}

export function createRemoteRuntime(dependencies: {
  spa: SpaAdapter;
  bubbles?: BubbleSessionManager;
  heating?: HeatingScheduler;
}): RemoteRuntime {
  const config = resolveRemoteRuntimeConfig();
  const transport = new NoneRemoteTransport();
  const executor = new RemoteCommandExecutor({
    installationId: config.installationId,
    spa: dependencies.spa,
    bubbles: dependencies.bubbles,
    heating: dependencies.heating,
    ledger: new FileRemoteCommandLedger(config.stateDir)
  });
  return {
    config,
    agent: new RemoteAgent(config.installationId, transport, executor)
  };
}
