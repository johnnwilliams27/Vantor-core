import type { IBankingAdapter } from './interface';
import { BridgeMockAdapter } from './mock/bridge-mock';
import { BridgeAdapter } from './bridge';
import type { IntegrationMode } from '@/lib/env/integration-mode';

export function getBankingAdapter(mode: IntegrationMode = 'mock'): IBankingAdapter {
  if (mode === 'mock') {
    return new BridgeMockAdapter();
  }

  // Both sandbox and live use the real Bridge adapter with appropriate keys
  return new BridgeAdapter(mode);
}
