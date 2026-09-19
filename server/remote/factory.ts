import path from 'node:path';
import type { HeatingPlanner } from '../heating/planner';
import type { HeatingScheduler } from '../heating/scheduler';
import type { BubbleSessionManager } from '../spa/bubbles';
import type { SpaAdapter } from '../spa/types';
import { RemoteAgent } from './agent';
import { RemoteCommandExecutor } from './executor';
import { FirebaseRemoteTransport } from './firebase';
import { FileRemoteCommandLedger } from './ledger';
import { RemoteSnapshotPublisher } from './snapshot';
import { NoneRemoteTransport } from './transports';
import type { RemoteTransport } from './types';

export interface RemoteRuntimeConfig {
  transport: 'none' | 'firebase';
  configuredTransport: string;
  installationId: string;
  stateDir: string;
  warning?: string;
}

export interface RemoteRuntime {
  config: RemoteRuntimeConfig;
  agent: RemoteAgent;
  publisher?: RemoteSnapshotPublisher;
}

export function resolveRemoteRuntimeConfig(): RemoteRuntimeConfig {
  const configuredTransport = String(process.env.REMOTE_TRANSPORT || 'none').trim().toLowerCase() || 'none';
  const configuredInstallationId = String(process.env.REMOTE_INSTALLATION_ID || '').trim();
  const installationId = configuredInstallationId || 'local-disabled';
  const stateDir = process.env.REMOTE_STATE_DIR || path.join(process.cwd(), 'data', 'remote');

  if (configuredTransport === 'firebase' && !configuredInstallationId) {
    return {
      transport: 'none',
      configuredTransport,
      installationId,
      stateDir,
      warning: 'REMOTE_TRANSPORT=firebase requires REMOTE_INSTALLATION_ID; remote control remains disabled.'
    };
  }

  if (configuredTransport !== 'none' && configuredTransport !== 'firebase') {
    return {
      transport: 'none',
      configuredTransport,
      installationId,
      stateDir,
      warning: `Unsupported REMOTE_TRANSPORT=${configuredTransport}; remote control remains disabled.`
    };
  }

  return {
    transport: configuredTransport as 'none' | 'firebase',
    configuredTransport,
    installationId,
    stateDir
  };
}

export function createRemoteRuntime(dependencies: {
  spa: SpaAdapter;
  bubbles?: BubbleSessionManager;
  heating?: HeatingScheduler;
  heatingPlanner?: HeatingPlanner;
}): RemoteRuntime {
  const config = resolveRemoteRuntimeConfig();
  const transport: RemoteTransport = config.transport === 'firebase'
    ? new FirebaseRemoteTransport({ installationId: config.installationId })
    : new NoneRemoteTransport();

  const executor = new RemoteCommandExecutor({
    installationId: config.installationId,
    spa: dependencies.spa,
    bubbles: dependencies.bubbles,
    heating: dependencies.heating,
    readyPlanner: dependencies.heatingPlanner,
    ledger: new FileRemoteCommandLedger(config.stateDir)
  });
  const agent = new RemoteAgent(config.installationId, transport, executor);
  const publisher = config.transport === 'firebase'
    ? new RemoteSnapshotPublisher(agent, dependencies.spa, dependencies.bubbles, dependencies.heating)
    : undefined;
  if (publisher) agent.setCommandCompletedHandler(() => publisher.publishNow());

  return {
    config,
    agent,
    ...(publisher ? { publisher } : {})
  };
}
