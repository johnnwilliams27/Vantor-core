import { describe, it, expect } from 'vitest';
import { checkMaxOutflow } from './max-outflow';
import { HardLimit } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext, AggregateWindowResult } from '../../types/context';

const mkDailyLimit = (value: string): HardLimit => ({
  id: 'hl-1',
  limit_type: 'max_daily_outflow_usd',
  name: 'Daily Outflow Cap',
  limit_value: value,
  limit_currency: 'USD',
  scope: {},
});

const mk30dLimit = (value: string): HardLimit => ({
  id: 'hl-2',
  limit_type: 'max_30day_outflow_usd',
  name: '30-Day Outflow Cap',
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

const mkContext = (
  dailySumUsd: string,
  canonicalAmt: string,
  thirtyDayResult?: AggregateWindowResult,
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
    positions_usd_by_asset: {},
    total_treasury_usd: '0',
    cash_equivalent_usd: '0',
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
      sum_amount_usd: dailySumUsd,
      sum_amount_by_asset: {},
      count: 0,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
      includes_proposed: false,
    },
    user_specs: thirtyDayResult ? { '30d': thirtyDayResult } : {},
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results: {},
  },
});

const mk30dResult = (sumUsd: string): AggregateWindowResult => ({
  window_spec_hash: '30d',
  window_start: new Date(Date.now() - 30 * 86_400_000),
  window_end: new Date(),
  sum_amount_usd: sumUsd,
  sum_amount_by_asset: {},
  count: 5,
  distinct_destinations: 1,
  distinct_counterparties: 1,
  included_evaluation_ids: [],
  includes_proposed: false,
});

describe('checkMaxOutflow — daily', () => {
  it('not breached when daily sum + proposed is under the cap', () => {
    const result = checkMaxOutflow(mkDailyLimit('1000000'), mkMovement('50000'), mkContext('800000', '50000'));
    expect(result.breached).toBe(false);
    expect(result.post_transfer_value).toBe('850000');
    expect(result.headroom).toBe('150000');
  });

  it('breached when daily sum + proposed exceeds the cap', () => {
    const result = checkMaxOutflow(mkDailyLimit('1000000'), mkMovement('300000'), mkContext('800000', '300000'));
    expect(result.breached).toBe(true);
    expect(result.post_transfer_value).toBe('1100000');
    expect(result.overage).toBe('100000');
  });

  it('returns failure when canonicalization failed', () => {
    const ctx = mkContext('800000', '');
    ctx.canonicalization.failure = {
      reason_code: 'canonicalization_failed',
      human_readable: 'Rate unavailable',
      details: {},
      user_action: 'Retry',
    };
    const result = checkMaxOutflow(mkDailyLimit('1000000'), mkMovement('50000'), ctx);
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });

  it('returns structured failure when daily sum is malformed', () => {
    const result = checkMaxOutflow(
      mkDailyLimit('1000000'),
      mkMovement('50000'),
      mkContext('garbage', '50000'),
    );
    expect(result.failure?.reason_code).toBe('historical_outflow_unavailable');
  });
});

describe('checkMaxOutflow — 30day', () => {
  it('not breached when 30-day sum + proposed is under the cap', () => {
    const result = checkMaxOutflow(
      mk30dLimit('10000000'),
      mkMovement('500000'),
      mkContext('0', '500000', mk30dResult('5000000')),
    );
    expect(result.breached).toBe(false);
    expect(result.post_transfer_value).toBe('5500000');
  });

  it('breached when 30-day sum + proposed exceeds the cap', () => {
    const result = checkMaxOutflow(
      mk30dLimit('10000000'),
      mkMovement('5000000'),
      mkContext('0', '5000000', mk30dResult('8000000')),
    );
    expect(result.breached).toBe(true);
    expect(result.overage).toBe('3000000');
  });

  it('returns historical_outflow_unavailable when 30-day data is not loaded', () => {
    const result = checkMaxOutflow(mk30dLimit('10000000'), mkMovement('500000'), mkContext('0', '500000'));
    expect(result.failure?.reason_code).toBe('historical_outflow_unavailable');
  });

  it('propagates failure when the 30d aggregate has a failure field', () => {
    const failedResult: AggregateWindowResult = {
      window_spec_hash: '30d',
      window_start: new Date(Date.now() - 30 * 86_400_000),
      window_end: new Date(),
      sum_amount_usd: '',
      sum_amount_by_asset: {},
      count: 0,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
      includes_proposed: false,
      failure: {
        reason_code: 'aggregate_query_failed',
        human_readable: '30d aggregate query timed out',
        details: {},
      },
    };
    const result = checkMaxOutflow(
      mk30dLimit('10000000'),
      mkMovement('500000'),
      mkContext('0', '500000', failedResult),
    );
    expect(result.failure?.reason_code).toBe('aggregate_query_failed');
  });

  it('contract: breached and failure are mutually exclusive (daily)', () => {
    const notBreached = checkMaxOutflow(
      mkDailyLimit('1000000'),
      mkMovement('50000'),
      mkContext('800000', '50000'),
    );
    expect(notBreached.breached).toBe(false);
    expect(notBreached.failure).toBeUndefined();

    const breached = checkMaxOutflow(
      mkDailyLimit('1000000'),
      mkMovement('300000'),
      mkContext('800000', '300000'),
    );
    expect(breached.breached).toBe(true);
    expect(breached.failure).toBeUndefined();
  });
});
