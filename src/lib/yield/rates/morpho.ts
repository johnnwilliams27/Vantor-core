import type { RateFetcher, RateResult } from './types';

const GRAPHQL_URL = 'https://blue-api.morpho.org/graphql';
const STEAKHOUSE_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';
const RESERVOIR_VAULT = '0xbeEF346d7099865208Ff331e4f648f4154DDAa05';

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

    // Fetch Steakhouse vault (USDC)
    const steakhouseData = await gql<MorphoVaultResponse>(VAULT_QUERY, {
      address: STEAKHOUSE_VAULT,
    });

    const steakhouseVault = steakhouseData?.data?.vaultByAddress;
    if (steakhouseVault) {
      const vaultAPY = steakhouseVault.state?.netApy ?? steakhouseVault.state?.apy ?? 0;
      results.push({
        protocol: 'morpho_steakhouse',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY: vaultAPY,
        rewardAPY: 0,
      });
    }

    // Fetch Reservoir vault (USDC)
    const reservoirData = await gql<MorphoVaultResponse>(VAULT_QUERY, {
      address: RESERVOIR_VAULT,
    });

    const reservoirVault = reservoirData?.data?.vaultByAddress;
    if (reservoirVault) {
      const vaultAPY = reservoirVault.state?.netApy ?? reservoirVault.state?.apy ?? 0;
      results.push({
        protocol: 'morpho_reservoir',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY: vaultAPY,
        rewardAPY: 0,
      });
    }

    return results;
  },
};
