export interface RateResult {
  protocol: string;
  token: string;
  chain: string;
  supplyAPY: number;
  rewardAPY: number;
}

export interface RateFetcher {
  fetchRates(): Promise<RateResult[]>;
}
