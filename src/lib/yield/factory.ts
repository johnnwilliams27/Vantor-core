import type { IYieldProtocol, YieldProtocolId, OnChainValue } from './interface';
import type { TokenSymbol } from '@/types/database';
import { MockYieldAdapter } from './mock/yield-mock';
import { getAaveOnChainValue } from './adapters/aave-v3';
import { getCompoundOnChainValue } from './adapters/compound-v3';
import { getErc4626OnChainValue } from './adapters/erc4626';
import { getOndoOnChainValue } from './adapters/ondo';
import { getKaminoOnChainValue, getDriftOnChainValue } from './adapters/solana-stubs';
import { getMorphoBlueOnChainValue } from './adapters/morpho-blue';

export function getYieldAdapter(protocol: YieldProtocolId): IYieldProtocol {
  return new MockYieldAdapter(protocol);
}

/**
 * Query on-chain value for a position. Routes to the correct live adapter
 * based on protocol. Falls back to stored values on error.
 */
export async function getOnChainValue(
  protocol: YieldProtocolId,
  walletAddress: string,
  token: TokenSymbol,
  storedValue: number,
  storedTokenBalance: number,
): Promise<OnChainValue> {
  try {
    switch (protocol) {
      case 'aave_v3':
        return await getAaveOnChainValue(walletAddress, token);
      case 'compound_v3':
        return await getCompoundOnChainValue(walletAddress, token);
      case 'morpho_steakhouse':
      case 'sky':
      case 'ethena':
        return await getErc4626OnChainValue(protocol, walletAddress, token);
      case 'ondo':
        return await getOndoOnChainValue(walletAddress, token);
      case 'kamino':
      case 'kamino_multiply':
        return await getKaminoOnChainValue(walletAddress, token, storedValue, storedTokenBalance);
      case 'drift':
        return await getDriftOnChainValue(walletAddress, token, storedValue, storedTokenBalance);
      case 'morpho':
        return await getMorphoBlueOnChainValue(walletAddress, token);
      default:
        return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
    }
  } catch (err) {
    console.error(`[yield/${protocol}] On-chain query failed, using stored value:`, err);
    return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
  }
}

export const ALL_YIELD_PROTOCOLS: YieldProtocolId[] = [
  'aave_v3', 'compound_v3', 'sky', 'ondo', 'morpho', 'morpho_steakhouse',
  'kamino', 'kamino_multiply', 'ethena', 'drift',
];
