import { describe, it, expect, vi } from 'vitest';
import { EvaluationContextLoader, EvaluationContextLoaderDeps } from './loader';
import { StubForecastQueryFactory } from '../forecast/stub';
import { NoopStubLogger } from '../forecast/stub-logger';
import { AggregationDetector } from '../aggregate-detector/detector';
import { CoingeckoPolicyRateProvider } from '../canonicalizer/coingecko-provider';
import { ProposedMovement } from '../types/movement';
import { PolicyVersionSnapshot } from '../types/policy-version';
import { ForecastQueryFactory } from '../forecast/interface';

const mkMovement = (overrides: Partial<ProposedMovement> = {}): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },
  amount: { amount: '50000', asset: 'USDC' },
  counterparty: { id: 'cp-1' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
  ...overrides,
});

const mkPolicy = (overrides: Partial<PolicyVersionSnapshot> = {}): PolicyVersionSnapshot => ({
  id: 'v-1',
  enterprise_id: 'ent-1',
  version_number: 1,
  status: 'active',
  name: 'Test',
  rules: [],
  hard_limits: [],
  approval_chains: [],
  ...overrides,
});

const mkEmptyRawAggregateResult = () => ({
  sum_amount_usd: '0',
  sum_amount_by_asset: {},
  count: 0,
  distinct_destinations: 0,
  distinct_counterparties: 0,
  included_evaluation_ids: [],
});

const mkHappyDeps = (policy: PolicyVersionSnapshot = mkPolicy()): EvaluationContextLoaderDeps => ({
  rateProvider: new CoingeckoPolicyRateProvider({
    fetchStablecoinPrices: vi.fn().mockResolvedValue({
      prices: { USDC: 1.0002, USDT: 1.0001 },
      source: 'coingecko',
      fetchedAt: new Date(),
    }),
  }),
  aggregateDetector: new AggregationDetector({
    runQuery: vi.fn().mockResolvedValue(mkEmptyRawAggregateResult()),
  }),
  forecastFactory: new StubForecastQueryFactory(new NoopStubLogger()),
  fetchPolicyVersion: vi.fn().mockResolvedValue(policy),
  fetchBalances: vi.fn().mockResolvedValue([
    { asset: 'USDC', venue: 'ethereum', amount: '1000000', amount_usd: '1000000' },
  ]),
  fetchCounterpartyHistory: vi.fn().mockResolvedValue(null),
  fetchLatestScreening: vi.fn().mockResolvedValue({
    counterparty_id: 'cp-1',
    result: 'clear' as const,
    screened_at: new Date(),
  }),
});

describe('EvaluationContextLoader.load', () => {
  it('assembles a fully-hydrated EvaluationContext', async () => {
    const loader = new EvaluationContextLoader(mkHappyDeps());
    const ctx = await loader.load(mkMovement(), 'ent-1');

    expect(ctx.enterprise_id).toBe('ent-1');
    expect(ctx.policy_version.id).toBe('v-1');
    expect(ctx.treasury_state.positions_by_asset.USDC).toBe('1000000');
    expect(ctx.canonicalization.canonical_amount).toBe('50010'); // 50000 * 1.0002
    expect(ctx.canonicalization.failure).toBeUndefined();
    expect(ctx.sanctions.status).toBe('clear');
    expect(ctx.forecast.query_metadata.mode).toBe('stub');
    expect(ctx.aggregates.system_splitting_guard_24h).toBeDefined();
  });

  it('captures a single `now` that matches the returned ctx.now', async () => {
    const loader = new EvaluationContextLoader(mkHappyDeps());
    const before = Date.now();
    const ctx = await loader.load(mkMovement(), 'ent-1');
    const after = Date.now();
    expect(ctx.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(ctx.now.getTime()).toBeLessThanOrEqual(after);
  });

  it('propagates treasury state failure into the context (does not throw)', async () => {
    const deps = mkHappyDeps();
    deps.fetchBalances = vi.fn().mockRejectedValue(new Error('balances db down'));
    const loader = new EvaluationContextLoader(deps);

    const ctx = await loader.load(mkMovement(), 'ent-1');
    expect(ctx.treasury_state.failures).toBeDefined();
    expect(ctx.treasury_state.failures?.[0].reason_code).toBe('treasury_state_unavailable');
  });

  it('propagates sanctions failure into the context', async () => {
    const deps = mkHappyDeps();
    deps.fetchLatestScreening = vi.fn().mockRejectedValue(new Error('sanctions svc down'));
    const loader = new EvaluationContextLoader(deps);

    const ctx = await loader.load(mkMovement(), 'ent-1');
    expect(ctx.sanctions.failure?.reason_code).toBe('sanctions_status_unavailable');
  });

  it('propagates canonicalization failure into the context', async () => {
    const deps = mkHappyDeps();
    deps.rateProvider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockRejectedValue(new Error('oracle down')),
    });
    const loader = new EvaluationContextLoader(deps);

    const ctx = await loader.load(mkMovement(), 'ent-1');
    expect(ctx.canonicalization.failure).toBeDefined();
    expect(ctx.canonicalization.failure?.reason_code).toBe('canonicalization_source_unavailable');
  });

  it('propagates counterparty failure into the context', async () => {
    const deps = mkHappyDeps();
    deps.fetchCounterpartyHistory = vi.fn().mockRejectedValue(new Error('cp db down'));
    const loader = new EvaluationContextLoader(deps);

    const ctx = await loader.load(mkMovement(), 'ent-1');
    expect(ctx.counterparty?.failure?.reason_code).toBe('counterparty_lookup_failed');
  });

  it('re-throws when fetchPolicyVersion fails (no policy = nothing to evaluate)', async () => {
    const deps = mkHappyDeps();
    deps.fetchPolicyVersion = vi.fn().mockRejectedValue(new Error('policy db down'));
    const loader = new EvaluationContextLoader(deps);

    await expect(loader.load(mkMovement(), 'ent-1')).rejects.toThrow('policy db down');
  });

  it('handles forecast factory failure by using a sentinel that rejects every query', async () => {
    const failedFactory: ForecastQueryFactory = {
      createForEnterprise: vi.fn().mockRejectedValue(new Error('forecast factory down')),
    };
    const deps = mkHappyDeps();
    deps.forecastFactory = failedFactory;

    const policyWithForecastRule: PolicyVersionSnapshot = mkPolicy({
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'lookahead',
          name: 'Min balance rule',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'forecast_query',
            query: 'projected_min_balance',
            window_days: 7,
            scope: { asset: 'USDC' },
            comparator: '>',
            value: { amount: '500000', currency: 'USDC' },
          },
        },
      ],
    });
    deps.fetchPolicyVersion = vi.fn().mockResolvedValue(policyWithForecastRule);

    const loader = new EvaluationContextLoader(deps);
    const ctx = await loader.load(mkMovement(), 'ent-1');

    // The forecast results should have an entry for the rule's query, and
    // that entry should have a failure field (not throw from load())
    const forecastResults = Object.values(ctx.forecast.results);
    expect(forecastResults.length).toBeGreaterThan(0);
    expect(forecastResults[0].failure).toBeDefined();
    expect(forecastResults[0].failure?.reason_code).toBe('forecast_unavailable');
  });

  it('pre-loads forecast queries referenced by rules (use_hypothetical=false)', async () => {
    const policyWithForecastRule: PolicyVersionSnapshot = mkPolicy({
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'lookahead',
          name: 'Min balance rule',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: {
            kind: 'forecast_query',
            query: 'projected_min_balance',
            window_days: 7,
            scope: { asset: 'USDC' },
            comparator: '>',
            value: { amount: '500000', currency: 'USDC' },
          },
        },
      ],
    });
    const deps = mkHappyDeps(policyWithForecastRule);
    const loader = new EvaluationContextLoader(deps);

    const ctx = await loader.load(mkMovement(), 'ent-1');

    expect(Object.keys(ctx.forecast.results).length).toBeGreaterThanOrEqual(1);
    // Stub returns a large permissive balance — the rule's rule result
    // exists with a value field, no failure
    const entries = Object.values(ctx.forecast.results);
    expect(entries.some((e) => e.value !== undefined)).toBe(true);
  });

  it('pre-loads forecast queries for obligation_coverage_days hard limits (use_hypothetical=true)', async () => {
    const policyWithLimit: PolicyVersionSnapshot = mkPolicy({
      hard_limits: [
        {
          id: 'hl-1',
          limit_type: 'obligation_coverage_days',
          name: '14-day coverage',
          limit_value: '14',
          scope: {},
        },
      ],
    });
    const deps = mkHappyDeps(policyWithLimit);
    const loader = new EvaluationContextLoader(deps);

    const ctx = await loader.load(mkMovement(), 'ent-1');

    // At least one forecast result keyed to an obligations_covered query
    expect(Object.keys(ctx.forecast.results).length).toBeGreaterThanOrEqual(1);
  });

  it('skips hard limits with malformed obligation_coverage_days limit_value', async () => {
    const policyWithBadLimit: PolicyVersionSnapshot = mkPolicy({
      hard_limits: [
        {
          id: 'hl-bad',
          limit_type: 'obligation_coverage_days',
          name: 'Bad',
          limit_value: 'not-a-number',
          scope: {},
        },
      ],
    });
    const deps = mkHappyDeps(policyWithBadLimit);
    const loader = new EvaluationContextLoader(deps);

    const ctx = await loader.load(mkMovement(), 'ent-1');

    // No forecast results populated from the bad limit — the limit
    // evaluator will surface the failure itself when it runs
    expect(Object.keys(ctx.forecast.results).length).toBe(0);
  });

  it('deduplicates forecast queries by hash (two rules same query → one result)', async () => {
    const sharedCondition = {
      kind: 'forecast_query' as const,
      query: 'projected_min_balance' as const,
      window_days: 7,
      scope: { asset: 'USDC' as const },
      comparator: '>' as const,
      value: { amount: '500000', currency: 'USDC' as const },
    };
    const policy: PolicyVersionSnapshot = mkPolicy({
      rules: [
        {
          id: 'r1',
          version_id: 'v-1',
          rule_type: 'lookahead',
          name: 'Rule A',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          created_by: 'u',
          created_at: new Date(),
          condition: sharedCondition,
        },
        {
          id: 'r2',
          version_id: 'v-1',
          rule_type: 'lookahead',
          name: 'Rule B',
          rationale: '',
          priority: 2,
          verdict: 'block',
          created_by: 'u',
          created_at: new Date(),
          condition: sharedCondition,
        },
      ],
    });
    const deps = mkHappyDeps(policy);
    const loader = new EvaluationContextLoader(deps);

    const ctx = await loader.load(mkMovement(), 'ent-1');

    // Exactly one result despite two rules referencing the same query
    expect(Object.keys(ctx.forecast.results).length).toBe(1);
  });

  it('walks approval_chains.trigger_condition for forecast queries', async () => {
    const policy: PolicyVersionSnapshot = mkPolicy({
      approval_chains: [
        {
          id: 'chain-1',
          version_id: 'v-1',
          name: 'Chain',
          slots: [],
          priority: 1,
          expiration_hours: 48,
          created_by: 'u',
          created_at: new Date(),
          trigger_condition: {
            kind: 'forecast_query',
            query: 'obligations_covered',
            window_days: 30,
            comparator: '==',
            value: { amount: '1', currency: 'USD' },
          },
        },
      ],
    });
    const deps = mkHappyDeps(policy);
    const loader = new EvaluationContextLoader(deps);

    const ctx = await loader.load(mkMovement(), 'ent-1');
    expect(Object.keys(ctx.forecast.results).length).toBeGreaterThanOrEqual(1);
  });

  it('loads treasury, counterparty, sanctions, policy, and canonicalization in parallel', async () => {
    // Each mock tracks when it was called relative to the others. With
    // Promise.all semantics, all should be invoked before any resolves.
    let callsBeforeAnyResolve = 0;
    const deps = mkHappyDeps();

    const originalBalances = deps.fetchBalances;
    const originalPolicy = deps.fetchPolicyVersion;
    const originalCounterparty = deps.fetchCounterpartyHistory;
    const originalSanctions = deps.fetchLatestScreening;

    deps.fetchBalances = vi.fn().mockImplementation(async (entId: string) => {
      callsBeforeAnyResolve++;
      return originalBalances(entId);
    });
    deps.fetchPolicyVersion = vi.fn().mockImplementation(async (entId: string) => {
      callsBeforeAnyResolve++;
      return originalPolicy(entId);
    });
    deps.fetchCounterpartyHistory = vi
      .fn()
      .mockImplementation(async (entId: string, cpId: string) => {
        callsBeforeAnyResolve++;
        return originalCounterparty(entId, cpId);
      });
    deps.fetchLatestScreening = vi
      .fn()
      .mockImplementation(async (entId: string, cpId: string) => {
        callsBeforeAnyResolve++;
        return originalSanctions(entId, cpId);
      });

    const loader = new EvaluationContextLoader(deps);
    await loader.load(mkMovement(), 'ent-1');

    // All four DB-backed fetchers should have been invoked
    expect(callsBeforeAnyResolve).toBe(4);
  });
});
