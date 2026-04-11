import { describe, it, expect } from 'vitest';
import { checkMinCashReserve } from './min-cash-reserve';
import { HardLimit } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';

const mkLimit = (value: string): HardLimit => ({
  id: 'hl-1',
  limit_type: 'min_cash_reserve_usd',
  name: 'Operating Cash Floor',
  limit_value: value,
  limit_currency: 'USD',
  scope: {},
});

const mkMovement = (amount: string): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },
  amount: { amount, asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
});

const mkContext = (cashUsd: string, canonicalAmount: string): EvaluationContext => ({
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
    positions_usd_by_asset: {},
    total_treasury_usd: cashUsd,
    cash_equivalent_usd: cashUsd,
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0',
    native_asset: 'USDC',
    canonical_amount: canonicalAmount,
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

describe('checkMinCashReserve', () => {
  it('not breached when post-transfer cash exceeds the floor', () => {
    const result = checkMinCashReserve(mkLimit('500000'), mkMovement('10000'), mkContext('600000', '10000'));
    expect(result.breached).toBe(false);
    expect(result.post_transfer_value).toBe('590000');
    expect(result.headroom).toBe('90000');
    expect(result.overage).toBeUndefined();
  });

  it('breached when post-transfer cash drops below the floor', () => {
    const result = checkMinCashReserve(mkLimit('500000'), mkMovement('150000'), mkContext('520000', '150000'));
    expect(result.breached).toBe(true);
    expect(result.post_transfer_value).toBe('370000');
    expect(result.overage).toBe('130000');
    expect(result.headroom).toBeUndefined();
  });

  it('exactly at floor is not breached (boundary)', () => {
    const result = checkMinCashReserve(mkLimit('500000'), mkMovement('100000'), mkContext('600000', '100000'));
    expect(result.breached).toBe(false);
    expect(result.post_transfer_value).toBe('500000');
  });

  it('returns failure when canonicalization failed', () => {
    const ctx = mkContext('600000', '');
    ctx.canonicalization.failure = {
      reason_code: 'canonicalization_failed',
      human_readable: 'Rate unavailable',
      details: {},
      user_action: 'Retry',
    };
    const result = checkMinCashReserve(mkLimit('500000'), mkMovement('10000'), ctx);
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });

  it('returns structured failure when cash_equivalent_usd is malformed', () => {
    const result = checkMinCashReserve(mkLimit('500000'), mkMovement('10000'), mkContext('garbage', '10000'));
    expect(result.failure?.reason_code).toBe('treasury_state_unavailable');
    expect(result.failure?.human_readable).toContain('malformed');
  });

  it('returns structured failure when limit_value is malformed', () => {
    const result = checkMinCashReserve(mkLimit('not-a-number'), mkMovement('10000'), mkContext('600000', '10000'));
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });
});
