import type { IBankingAdapter } from './interface';
import { BridgeMockAdapter } from './mock/bridge-mock';
import type { IntegrationMode } from '@/lib/env/integration-mode';

export function getBankingAdapter(mode: IntegrationMode = 'mock'): IBankingAdapter {
  if (mode === 'mock') {
    return new BridgeMockAdapter();
  }

  // TODO: Real Bridge adapter — for now fall back to mock
  // When implemented: return new BridgeAdapter(mode === 'sandbox' ? sandboxKeys : liveKeys);
  return new BridgeMockAdapter();
}
