import { describe, it, expect } from 'vitest';
import { HardLimitChecker } from './checker';
import { HardLimit } from '../types/hard-limit';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';

const mkMovement = (amount: string): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },
  amount: { amount, asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
});

const mkContext = (
  limits: HardLimit[],
  cashUsd: string,
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
    hard_limits: limits,
    approval_chains: [],
  },
  treasury_state: {
    positions_by_asset: { USDC: '1000000' },
    positions_by_asset_venue: {},
    positions_usd_by_asset: { USDC: cashUsd },
    total_treasury_usd: cashUsd,
    cash_equivalent_usd: cashUsd,
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

describe('HardLimitChecker', () => {
  it('evaluates all limits and returns HardLimitCheckResult', () => {
    const limits: HardLimit[] = [
      {
        id: 'hl-1',
        limit_type: 'min_cash_reserve_usd',
        name: 'Cash Floor',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
      },
    ];
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('10000'), mkContext(limits, '600000', '10000'));

    expect(result.evaluated).toHaveLength(1);
    expect(result.any_breached).toBe(false);
    expect(result.breaches).toHaveLength(0);
  });

  it('populates breaches when at least one limit is breached', () => {
    const limits: HardLimit[] = [
      {
        id: 'hl-1',
        limit_type: 'min_cash_reserve_usd',
        name: 'Cash Floor',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
      },
    ];
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('200000'), mkContext(limits, '520000', '200000'));

    expect(result.any_breached).toBe(true);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0].reason_code).toBe('hard_limit_breached');
    expect(result.breaches[0].human_readable).toContain('Cash Floor');
    expect(result.breaches[0].user_action).toBeDefined();
    expect(result.breaches[0].user_action.length).toBeGreaterThan(0);
  });

  it('evaluates ALL limits even past a breach (complete trace)', () => {
    const limits: HardLimit[] = [
      {
        id: 'hl-1',
        limit_type: 'min_cash_reserve_usd',
        name: 'Cash Floor',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
      },
      {
        id: 'hl-2',
        limit_type: 'max_daily_outflow_usd',
        name: 'Daily Cap',
        limit_value: '1000000',
        limit_currency: 'USD',
        scope: {},
      },
    ];
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('200000'), mkContext(limits, '520000', '200000'));

    expect(result.evaluated).toHaveLength(2);
    expect(result.evaluated.map((e) => e.limit_id)).toEqual(['hl-1', 'hl-2']);
  });

  it('empty limits array produces empty result (not breached, no breaches)', () => {
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('10000'), mkContext([], '600000', '10000'));

    expect(result.evaluated).toHaveLength(0);
    expect(result.any_breached).toBe(false);
    expect(result.breaches).toHaveLength(0);
  });

  it('does NOT promote a breach when the evaluation also has a failure (failure wins)', () => {
    // Trigger min_cash_reserve to fail via malformed canonical_amount.
    // Even if post-transfer value would be below floor, the failure means
    // "could not evaluate" and should not produce a HardLimitBreach row —
    // the caller checks evaluated[].failure separately.
    const limits: HardLimit[] = [
      {
        id: 'hl-1',
        limit_type: 'min_cash_reserve_usd',
        name: 'Cash Floor',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
      },
    ];
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('200000'), mkContext(limits, '520000', 'garbage'));

    expect(result.evaluated).toHaveLength(1);
    expect(result.evaluated[0].failure).toBeDefined();
    expect(result.any_breached).toBe(false);
    expect(result.breaches).toHaveLength(0);
  });

  it('handles multiple breaches in one pass', () => {
    const limits: HardLimit[] = [
      {
        id: 'hl-1',
        limit_type: 'min_cash_reserve_usd',
        name: 'Cash Floor',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
      },
      {
        id: 'hl-2',
        limit_type: 'max_daily_outflow_usd',
        name: 'Daily Cap',
        limit_value: '100000', // tiny cap to force breach
        limit_currency: 'USD',
        scope: {},
      },
    ];
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('200000'), mkContext(limits, '520000', '200000'));

    expect(result.breaches).toHaveLength(2);
    expect(result.breaches.map((b) => b.limit_id).sort()).toEqual(['hl-1', 'hl-2']);
  });

  it('overage is always set on a HardLimitBreach (never undefined)', () => {
    const limits: HardLimit[] = [
      {
        id: 'hl-1',
        limit_type: 'min_cash_reserve_usd',
        name: 'Cash Floor',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
      },
    ];
    const checker = new HardLimitChecker();
    const result = checker.check(mkMovement('200000'), mkContext(limits, '520000', '200000'));

    expect(result.breaches[0].overage).toBeDefined();
    expect(typeof result.breaches[0].overage).toBe('string');
    expect(result.breaches[0].overage.length).toBeGreaterThan(0);
  });
});
