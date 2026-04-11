import type { RateFetcher, RateResult } from './types';

const GRAPHQL_URL = 'https://blue-api.morpho.org/graphql';
const STEAKHOUSE_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';
const RESERVOIR_VAULT = '0xbeEF346d7099865208Ff331e4f648f4154DDAa05';

// Morpho Blue API exposes TVL directly as totalAssetsUsd on the vault state.
// totalAssets is in the underlying token's smallest unit (6 decimals for USDC),
// totalAssetsUsd is the pre-computed USD value. Prefer the USD field when
// present, fall back to the raw field for stablecoin vaults.
const VAULT_QUERY = `
  query VaultQuery($address: String!) {
    vaultByAddress(address: $address) {
      address
      state {
        apy
        netApy
        totalAssets
        totalAssetsUsd
      }
    }
  }
`;

const USDC_DECIMALS = 6;

interface MorphoVaultState {
  apy: number | null;
  netApy: number | null;
  totalAssets: string | number | null;
  totalAssetsUsd: number | null;
}

interface MorphoVaultResponse {
  data?: {
    vaultByAddress?: {
      address: string;
      state: MorphoVaultState | null;
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

function parseTvl(state: MorphoVaultState | null | undefined): number | null {
  if (!state) return null;
  // Prefer the pre-computed USD value when the API provides it.
  if (typeof state.totalAssetsUsd === 'number' && Number.isFinite(state.totalAssetsUsd)) {
    return state.totalAssetsUsd;
  }
  // Fall back to the raw underlying-token amount (USDC vaults use 6 decimals
  // and the token is dollar-pegged, so the USD value matches).
  if (state.totalAssets != null) {
    const raw = typeof state.totalAssets === 'string'
      ? Number(state.totalAssets)
      : state.totalAssets;
    if (Number.isFinite(raw)) return raw / 10 ** USDC_DECIMALS;
  }
  return null;
}

async function fetchVault(
  address: string,
  protocolSlug: string,
): Promise<RateResult | null> {
  const data = await gql<MorphoVaultResponse>(VAULT_QUERY, { address });
  const vault = data?.data?.vaultByAddress;
  if (!vault) return null;

  const state = vault.state ?? null;
  const vaultAPY = state?.netApy ?? state?.apy ?? 0;
  const tvlUsd = parseTvl(state);

  return {
    protocol: protocolSlug,
    token: 'USDC',
    chain: 'ethereum',
    supplyAPY: vaultAPY,
    rewardAPY: 0,
    tvlUsd,
  };
}

export const morphoFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const [steakhouse, reservoir] = await Promise.all([
      fetchVault(STEAKHOUSE_VAULT, 'morpho_steakhouse'),
      fetchVault(RESERVOIR_VAULT, 'morpho_reservoir'),
    ]);
    return [steakhouse, reservoir].filter((r): r is RateResult => r !== null);
  },
};
