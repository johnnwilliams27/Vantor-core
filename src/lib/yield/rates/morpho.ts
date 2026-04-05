import type { RateFetcher, RateResult } from './types';

const GRAPHQL_URL = 'https://blue-api.morpho.org/graphql';
const STEAKHOUSE_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';

const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7';

const MARKETS_QUERY = `
  query MarketsQuery {
    markets(first: 50, where: { whitelisted: true }) {
      items {
        uniqueKey
        loanAsset {
          address
          symbol
        }
        state {
          supplyApy
        }
      }
    }
  }
`;

const VAULT_QUERY = `
  query VaultQuery($address: String!) {
    vaultByAddress(address: $address) {
      address
      state {
        apy
        netApy
      }
    }
  }
`;

interface MorphoMarketItem {
  uniqueKey: string;
  loanAsset: { address: string; symbol: string };
  state: { supplyApy: number | null } | null;
}

interface MorphoMarketsResponse {
  data?: {
    markets?: {
      items?: MorphoMarketItem[];
    };
  };
}

interface MorphoVaultResponse {
  data?: {
    vaultByAddress?: {
      address: string;
      state: { apy: number | null; netApy: number | null } | null;
    } | null;
  };
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Morpho GraphQL error: ${res.status}`);
  return res.json() as Promise<T>;
}

export const morphoFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const results: RateResult[] = [];

    // Fetch Blue markets for USDC and USDT
    const marketsData = await gql<MorphoMarketsResponse>(MARKETS_QUERY);
    const items = marketsData?.data?.markets?.items ?? [];

    const usdcMarkets = items.filter(
      (m) => m.loanAsset?.address?.toLowerCase() === USDC_ADDRESS,
    );
    const usdtMarkets = items.filter(
      (m) => m.loanAsset?.address?.toLowerCase() === USDT_ADDRESS,
    );

    // Pick highest supply APY per token among whitelisted markets
    const bestUsdc = usdcMarkets.reduce<MorphoMarketItem | null>((best, m) => {
      const apy = m.state?.supplyApy ?? 0;
      return best === null || apy > (best.state?.supplyApy ?? 0) ? m : best;
    }, null);

    const bestUsdt = usdtMarkets.reduce<MorphoMarketItem | null>((best, m) => {
      const apy = m.state?.supplyApy ?? 0;
      return best === null || apy > (best.state?.supplyApy ?? 0) ? m : best;
    }, null);

    if (bestUsdc) {
      results.push({
        protocol: 'morpho',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY: bestUsdc.state?.supplyApy ?? 0,
        rewardAPY: 0,
      });
    }

    if (bestUsdt) {
      results.push({
        protocol: 'morpho',
        token: 'USDT',
        chain: 'ethereum',
        supplyAPY: bestUsdt.state?.supplyApy ?? 0,
        rewardAPY: 0,
      });
    }

    // Fetch Steakhouse vault (USDC)
    const vaultData = await gql<MorphoVaultResponse>(VAULT_QUERY, {
      address: STEAKHOUSE_VAULT,
    });

    const vault = vaultData?.data?.vaultByAddress;
    if (vault) {
      const vaultAPY = vault.state?.netApy ?? vault.state?.apy ?? 0;
      results.push({
        protocol: 'morpho_steakhouse',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY: vaultAPY,
        rewardAPY: 0,
      });
    }

    return results;
  },
};
