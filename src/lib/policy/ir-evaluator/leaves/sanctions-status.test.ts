import { describe, it, expect } from 'vitest';
import { evalSanctionsStatus } from './sanctions-status';
import { SanctionsStatusNode } from '../../types/ir';
import { EvaluationContext } from '../../types/context';

const makeContext = (
  status: EvaluationContext['sanctions']['status'],
  overrides: Partial<EvaluationContext> = {},
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
    canonical_amount: '0',
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
  sanctions: { status },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results: {},
  },
  ...overrides,
});

describe('evalSanctionsStatus', () => {
  it('matches when status is in the values list', () => {
    const node: SanctionsStatusNode = {
      kind: 'sanctions_status',
      op: 'in',
      values: ['sanctioned', 'partial_match'],
    };
    expect(evalSanctionsStatus(node, makeContext('sanctioned')).matched).toBe(true);
    expect(evalSanctionsStatus(node, makeContext('partial_match')).matched).toBe(true);
    expect(evalSanctionsStatus(node, makeContext('clear')).matched).toBe(false);
  });

  it('matches with not_in operator', () => {
    const node: SanctionsStatusNode = {
      kind: 'sanctions_status',
      op: 'not_in',
      values: ['clear'],
    };
    expect(evalSanctionsStatus(node, makeContext('clear')).matched).toBe(false);
    expect(evalSanctionsStatus(node, makeContext('sanctioned')).matched).toBe(true);
    expect(evalSanctionsStatus(node, makeContext('unscreened')).matched).toBe(true);
  });

  it('returns failure when sanctions status is unavailable', () => {
    const node: SanctionsStatusNode = {
      kind: 'sanctions_status',
      op: 'in',
      values: ['sanctioned'],
    };
    const ctx = makeContext('clear', {
      sanctions: {
        status: 'unscreened',
        failure: {
          reason_code: 'sanctions_status_unavailable',
          human_readable: 'Sanctions screening service unavailable',
          details: {},
        },
      },
    });
    const result = evalSanctionsStatus(node, ctx);
    expect(result.failure?.reason_code).toBe('sanctions_status_unavailable');
    expect(result.matched).toBe(false);
  });

  it('contract: matched=true results have failure undefined', () => {
    const node: SanctionsStatusNode = {
      kind: 'sanctions_status',
      op: 'in',
      values: ['sanctioned'],
    };
    const result = evalSanctionsStatus(node, makeContext('sanctioned'));
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });
});
