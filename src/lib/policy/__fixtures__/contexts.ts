// src/lib/policy/__fixtures__/contexts.ts

import {
  EvaluationContext,
  TreasuryState,
  CanonicalizationResult,
  AggregateWindowResults,
  ForecastSnapshot,
  SanctionsSnapshot,
} from '../types/context';
import { AssetCode } from '../types/assets';
import { standardPolicy } from './policy-versions';

export function healthyContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    now: new Date('2026-04-10T14:22:33.000Z'),
    enterprise_id: 'ent-fixture-1',
    policy_version: overrides.policy_version ?? standardPolicy(),
    treasury_state: healthyTreasuryState(),
    canonicalization: successfulCanonicalization('10000', 'USDC', '10002'),
    aggregates: emptyAggregates(),
    sanctions: clearSanctions(),
    forecast: stubForecastSnapshot(),
    counterparty: undefined,
    ...overrides,
  };
}

export function healthyTreasuryState(): TreasuryState {
  return {
    positions_by_asset: { USDC: '5000000', USDT: '2000000', USD: '1000000' },
    positions_by_asset_venue: {
      'USDC:ethereum': '3000000',
      'USDC:solana': '2000000',
      'USDT:ethereum': '2000000',
      'USD:svb': '1000000',
    },
    positions_usd_by_asset: { USDC: '5000000', USDT: '2000000', USD: '1000000' },
    total_treasury_usd: '8000000',
    cash_equivalent_usd: '8000000',
    loaded_at: new Date('2026-04-10T14:22:33.000Z'),
  };
}

export function successfulCanonicalization(
  nativeAmount: string,
  nativeAsset: AssetCode,
  canonicalAmount: string,
): CanonicalizationResult {
  return {
    native_amount: nativeAmount,
    native_asset: nativeAsset,
    canonical_amount: canonicalAmount,
    canonical_currency: 'USD',
    rate: '1.0002',
    rate_source: 'coingecko',
    rate_as_of: new Date('2026-04-10T14:22:00.000Z'),
    max_age_ms: 60_000,
  };
}

export function emptyAggregates(): AggregateWindowResults {
  return {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys-fixture',
      window_start: new Date('2026-04-09T14:22:33.000Z'),
      window_end: new Date('2026-04-10T14:22:33.000Z'),
      sum_amount_usd: '0',
      sum_amount_by_asset: {},
      count: 0,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
      includes_proposed: false,
    },
    user_specs: {},
  };
}

export function clearSanctions(): SanctionsSnapshot {
  return { status: 'clear' };
}

export function stubForecastSnapshot(): ForecastSnapshot {
  return {
    query_metadata: {
      mode: 'stub',
      snapshot_taken_at: new Date('2026-04-10T14:22:33.000Z'),
      source: 'stub-pass-through',
      warnings: ['FORECAST_STUB_MODE: fixture'],
    },
    hypothetical_metadata: {
      mode: 'stub',
      snapshot_taken_at: new Date('2026-04-10T14:22:33.000Z'),
      source: 'stub-pass-through',
      warnings: ['FORECAST_STUB_MODE: fixture'],
    },
    results: {},
  };
}
