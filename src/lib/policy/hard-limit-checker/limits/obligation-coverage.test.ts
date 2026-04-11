import { describe, it, expect } from 'vitest';
import { checkObligationCoverage } from './obligation-coverage';
import { computeForecastQueryHash } from '../../ir-evaluator/leaves/forecast-query';
import { HardLimit } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext, ForecastQueryResult } from '../../types/context';
import { ForecastQueryNode } from '../../types/ir';

const mkLimit = (windowDays: string): HardLimit => ({
  id: 'hl-1',
  limit_type: 'obligation_coverage_days',
  name: 'Obligation Coverage',
  limit_value: windowDays,
  scope: {},
});

const mkMovement = (): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },
  amount: { amount: '10000', asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
});

const mkContext = (windowDays: number, result: ForecastQueryResult | null): EvaluationContext => {
  const node: ForecastQueryNode = {
    kind: 'forecast_query',
    query: 'obligations_covered',
    window_days: windowDays,
    comparator: '==',
    value: { amount: '1', currency: 'USD' },
  };
  const hash = computeForecastQueryHash(node);
  return {
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
    sanctions: { status: 'clear' },
    forecast: {
      query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
      hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
      results: result ? { [hash]: result } : {},
    },
  };
};

describe('checkObligationCoverage', () => {
  it('not breached when forecast says obligations are covered', () => {
    const result = checkObligationCoverage(
      mkLimit('14'),
      mkMovement(),
      mkContext(14, { value: { covered: true, obligations_checked: 5, obligations_uncovered: 0 } }),
    );
    expect(result.breached).toBe(false);
    expect(result.current_value).toBe('covered');
  });

  it('breached when forecast says obligations are not covered', () => {
    const result = checkObligationCoverage(
      mkLimit('14'),
      mkMovement(),
      mkContext(14, { value: { covered: false, obligations_checked: 5, obligations_uncovered: 2 } }),
    );
    expect(result.breached).toBe(true);
    expect(result.current_value).toBe('not_covered');
  });

  it('returns forecast_unavailable when no matching forecast result is loaded', () => {
    const result = checkObligationCoverage(mkLimit('14'), mkMovement(), mkContext(14, null));
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });

  it('returns failure when forecast result has a failure field', () => {
    const result = checkObligationCoverage(
      mkLimit('14'),
      mkMovement(),
      mkContext(14, {
        failure: {
          reason_code: 'forecast_unavailable',
          human_readable: 'Forecast service down',
          details: {},
        },
      }),
    );
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });

  it('returns structured failure when limit_value is not a positive integer', () => {
    const result = checkObligationCoverage(mkLimit('not-a-number'), mkMovement(), mkContext(14, null));
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });

  it('returns structured failure when payload covered field is missing', () => {
    const result = checkObligationCoverage(
      mkLimit('14'),
      mkMovement(),
      mkContext(14, { value: { obligations_checked: 5 } as unknown }),
    );
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });

  it('contract: breached and failure are mutually exclusive', () => {
    const covered = checkObligationCoverage(
      mkLimit('14'),
      mkMovement(),
      mkContext(14, { value: { covered: true, obligations_checked: 5, obligations_uncovered: 0 } }),
    );
    expect(covered.breached).toBe(false);
    expect(covered.failure).toBeUndefined();

    const notCovered = checkObligationCoverage(
      mkLimit('14'),
      mkMovement(),
      mkContext(14, { value: { covered: false, obligations_checked: 5, obligations_uncovered: 2 } }),
    );
    expect(notCovered.breached).toBe(true);
    expect(notCovered.failure).toBeUndefined();
  });
});
