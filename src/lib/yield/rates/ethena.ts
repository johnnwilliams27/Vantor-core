import type { RateFetcher, RateResult } from './types';

const ETHENA_API_URL =
  'https://ethena.fi/api/yields/protocol-and-staking-yield';

interface EthenaYieldEntry {
  type?: string;
  name?: string;
  apy?: number;
  value?: number;
  [key: string]: unknown;
}

interface EthenaResponse {
  sUSDe?: { apy?: number };
  protocolYield?: number;
  stakingYield?: number;
  [key: string]: unknown;
}

function extractSUsdeAPY(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;

  const obj = data as Record<string, unknown>;

  // Common shape: { sUSDe: { apy: 0.12 } }
  if (obj.sUSDe && typeof obj.sUSDe === 'object') {
    const entry = obj.sUSDe as EthenaYieldEntry;
    if (typeof entry.apy === 'number') return entry.apy;
    if (typeof entry.value === 'number') return entry.value;
  }

  // Flat top-level apy fields
  if (typeof (obj as EthenaResponse).stakingYield === 'number') {
    return (obj as EthenaResponse).stakingYield!;
  }

  // Array shape: [{ type: 'sUSDe', apy: 0.12 }, ...]
  if (Array.isArray(data)) {
    const entry = (data as EthenaYieldEntry[]).find(
      (e) =>
        e.type === 'sUSDe' ||
        e.name === 'sUSDe' ||
        e.type === 'staking',
    );
    if (entry) {
      if (typeof entry.apy === 'number') return entry.apy;
      if (typeof entry.value === 'number') return entry.value;
    }
  }

  return 0;
}

export const ethenaFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const res = await fetch(ETHENA_API_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Ethena API error: ${res.status}`);

    const data: unknown = await res.json();
    const supplyAPY = extractSUsdeAPY(data);

    return [
      {
        protocol: 'ethena',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
      },
      {
        protocol: 'ethena',
        token: 'USDT',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
      },
    ];
  },
};
