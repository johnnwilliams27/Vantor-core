import { describe, it, expect } from 'vitest';
import { checkMaxConcentration } from './max-concentration';
import { HardLimit } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

const mkLimit = (value: string): HardLimit => ({
  id: 'hl-1',
  limit_type: 'max_single_asset_concentration_pct',
  name: 'Asset Concentration Cap',
  limit_value: value,
  scope: {},
});

const mkMovement = (amount: string, sourceAsset: 'USDC' | 'USDT' = 'USDC'): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: sourceAsset },
  destination: { venue: 'external', asset: sourceAsset },
  amount: { amount, asset: sourceAsset },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
});

const mkContext = (
  positions: Record<string, string>,
  total: string,
  canonicalAmt: string,
): EvaluationContext => ({
  now: new Date(),
  enterprise_id: 'ent-1',
  policy_version: {
    id: 'v-1',
    enterprise_id: 'ent-1',
    version_number: 1,
    status: 'active',
    name: 'Test',
    rules: [],
    hard_limits: [],
    approval_chains: [],
  },
  treasury_state: {
    positions_by_asset: {},
    positions_by_asset_venue: {},
    positions_usd_by_asset: positions,
    total_treasury_usd: total,
    cash_equivalent_usd: total,
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0',
    native_asset: 'USDC',
    canonical_amount: canonicalAmt,
    canonical_currency: 'USD',
    rate: '1',
    rate_source: 'test',
    rate_as_of: new Date(),
    max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys',
      window_start: new Date(),
      window_end: new Date(),
      sum_amount_usd: '0',
      sum_amount_by_asset: {},
      count: 0,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
      includes_proposed: false,
    },
    user_specs: {},
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results: {},
  },
});

describe('checkMaxConcentration', () => {
  it('not breached when no asset exceeds the cap after transfer', () => {
    // 60% USDC + 40% USDT, cap 70% — outflow shouldn't push USDT over 70%
    const result = checkMaxConcentration(
      mkLimit('70'),
      mkMovement('100000', 'USDC'),
      mkContext({ USDC: '600000', USDT: '400000' }, '1000000', '100000'),
    );
    expect(result.breached).toBe(false);
  });

  it('breached when post-transfer concentration exceeds the cap', () => {
    // 50% USDC + 50% USDT, cap 50% — outflow USDC shrinks denom & makes USDT > 50%
    const result = checkMaxConcentration(
      mkLimit('50'),
      mkMovement('200000', 'USDC'),
      mkContext({ USDC: '500000', USDT: '500000' }, '1000000', '200000'),
    );
    expect(result.breached).toBe(true);
    // After: USDC=300k, USDT=500k, total=800k, USDT=62.5%
    expect(result.post_transfer_value).toBe('62.50');
  });

  it('returns failure when canonicalization failed', () => {
    const ctx = mkContext({ USDC: '500000', USDT: '500000' }, '1000000', '');
    ctx.canonicalization.failure = {
      reason_code: 'canonicalization_failed',
      human_readable: 'Rate unavailable',
      details: {},
      user_action: 'Retry',
    };
    const result = checkMaxConcentration(mkLimit('60'), mkMovement('100000'), ctx);
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });

  it('returns structured failure when total_treasury_usd is malformed', () => {
    const result = checkMaxConcentration(
      mkLimit('60'),
      mkMovement('100000'),
      mkContext({ USDC: '500000' }, 'garbage', '100000'),
    );
    expect(result.failure?.reason_code).toBe('treasury_state_unavailable');
  });
});
