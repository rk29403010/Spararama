import type { SpaAdapter } from './types';
import { ManualSpaAdapter } from './manual';
import { MockSpaAdapter } from './mock';
import { RecoveryBridgeSpaAdapter } from './recovery-bridge';

export function createSpaAdapter(): SpaAdapter {
  const mode = String(process.env.SPA_ADAPTER || 'bridge').toLowerCase();
  if (mode === 'mock') return new MockSpaAdapter();
  if (mode === 'manual' || mode === 'none') return new ManualSpaAdapter();
  if (mode === 'bridge' || mode === 'cleverspa') return new RecoveryBridgeSpaAdapter();
  throw new Error(`Unsupported SPA_ADAPTER: ${mode}`);
}
