import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

const GRAPHQL_URL = 'https://blue-api.morpho.org/graphql';

const USER_POSITIONS_QUERY = `
  query UserPositions($address: String!) {
    userByAddress(address: $address) {
      positions {
        market {
          uniqueKey
          loanAsset { address symbol decimals }
        }
        supplyAssets
        supplyShares
      }
    }
  }
`;

export async function getMorphoBlueOnChainValue(
  walletAddress: string,
  token: TokenSymbol,
): Promise<OnChainValue> {
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: USER_POSITIONS_QUERY,
        variables: { address: walletAddress.toLowerCase() },
      }),
    });

    if (!res.ok) return { currentValueUsd: 0, yieldTokenBalance: 0 };

    const data = await res.json();
    const positions = data?.data?.userByAddress?.positions ?? [];

    const matching = positions.filter(
      (p: any) => p.market?.loanAsset?.symbol?.toUpperCase() === token,
    );

    if (matching.length === 0) return { currentValueUsd: 0, yieldTokenBalance: 0 };

    let totalAssets = 0;
    let totalShares = 0;
    for (const pos of matching) {
      const decimals = pos.market.loanAsset.decimals ?? 6;
      totalAssets += parseFloat(pos.supplyAssets) / 10 ** decimals;
      totalShares += parseFloat(pos.supplyShares) / 1e18;
    }

    return { currentValueUsd: totalAssets, yieldTokenBalance: totalShares };
  } catch (err) {
    console.error('[morpho-blue] Position query failed:', err);
    return { currentValueUsd: 0, yieldTokenBalance: 0 };
  }
}
