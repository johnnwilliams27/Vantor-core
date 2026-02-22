import type { IBankingAdapter } from './interface';
import { BridgeMockAdapter } from './mock/bridge-mock';

export function getBankingAdapter(): IBankingAdapter {
  const useMock = process.env.BANKING_USE_MOCK !== 'false';

  if (useMock) {
    return new BridgeMockAdapter();
  }

  // Real Bridge adapter would be loaded here
  throw new Error('Real banking adapter not implemented. Set BANKING_USE_MOCK=true.');
}
