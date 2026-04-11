export interface RateResult {
  protocol: string;
  token: string;
  chain: string;
  supplyAPY: number;
  rewardAPY: number;
  /**
   * Pool Total Value Locked in USD for this (protocol, token, chain) row.
   * null means the fetcher couldn't determine TVL this run — the row is
   * still upserted so the rate survives, but downstream consumers should
   * treat TVL as unknown.
   */
  tvlUsd?: number | null;
}

export interface RateFetcher {
  fetchRates(): Promise<RateResult[]>;
}
