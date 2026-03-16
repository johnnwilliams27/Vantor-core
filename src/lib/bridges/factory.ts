import type { IBridgeAdapter, BridgeProvider } from './interface';
import { CctpAdapter } from './cctp';
import { LayerZeroAdapter } from './layerzero';

const adapters: Record<BridgeProvider, IBridgeAdapter> = {
  cctp: new CctpAdapter(),
  layerzero: new LayerZeroAdapter(),
};

export function getBridgeAdapter(provider: BridgeProvider): IBridgeAdapter {
  return adapters[provider];
}
