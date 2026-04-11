import type { IYieldProtocol, YieldProtocolId, OnChainValue } from './interface';
import type { TokenSymbol } from '@/types/database';
import { MockYieldAdapter } from './mock/yield-mock';
import { getAaveOnChainValue } from './adapters/aave-v3';
import { getCompoundOnChainValue } from './adapters/compound-v3';
import { getErc4626OnChainValue } from './adapters/erc4626';
import { getOndoOnChainValue } from './adapters/ondo';
import { ALL_VENUE_IDS } from './venues';

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
      case 'morpho_reservoir':
      case 'sky':
      case 'ethena':
        return await getErc4626OnChainValue(protocol, walletAddress, token);
      case 'ondo_usdy':
        return await getOndoOnChainValue(walletAddress, token);
      case 'kamino':
      case 'kamino_multiply': {
        // TODO: Pass test mode cluster through from the server-side caller so
        // devnet positions can be queried in test mode. For now we always use
        // mainnet — test mode positions have no on-chain state on mainnet anyway.
        // To fix: read the vantor_test_mode cookie in the position refresh route
        // and pass cluster: SolanaCluster down to getOnChainValue.
        const { getKaminoPosition } = await import('./contracts/solana/kamino');
        const { Connection, PublicKey } = await import('@solana/web3.js');
        const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
        return await getKaminoPosition(conn, new PublicKey(walletAddress), token);
      }
      default:
        return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
    }
  } catch (err) {
    console.error(`[yield/${protocol}] On-chain query failed, using stored value:`, err);
    return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
  }
}

/**
 * The complete list of yield protocol IDs the app knows about — derived
 * from the venue registry so it can't drift. Every venue in
 * `src/lib/yield/venues/registry.ts` appears here automatically, which
 * means adding a new venue to the registry is a single-file change.
 *
 * Previously this was a hand-maintained literal which silently omitted
 * the six tokenized MMF IDs added in the venue-categories PR — the API
 * iterated over this array to build the Yield Explorer response, so
 * the MMFs never showed up on the Explore Protocols tab. Fixed by
 * sourcing the list from the registry directly.
 */
export const ALL_YIELD_PROTOCOLS: readonly YieldProtocolId[] = ALL_VENUE_IDS;
