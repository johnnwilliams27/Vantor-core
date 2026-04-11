import { describe, it, expect } from 'vitest';
import { EvaluationEngine } from './evaluator';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';
import { PolicyVersionSnapshot } from '../types/policy-version';

const mkMovement = (overrides: Partial<ProposedMovement> = {}): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },
  amount: { amount: '10000', asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: new Date().toISOString(),
  ...overrides,
});

const mkContext = (policy: PolicyVersionSnapshot): EvaluationContext => ({
  now: new Date(),
  enterprise_id: 'ent-1',
  policy_version: policy,
  treasury_state: {
    positions_by_asset: { USDC: '1000000' },
    positions_by_asset_venue: { 'USDC:ethereum': '1000000' },
    positions_usd_by_asset: { USDC: '1000000' },
    total_treasury_usd: '1000000',
    cash_equivalent_usd: '1000000',
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '10000',
    native_asset: 'USDC',
    canonical_amount: '10002',
    canonical_currency: 'USD',
    rate: '1.0002',
    rate_source: 'coingecko',
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

describe('EvaluationEngine.evaluate', () => {
  it('returns allow_auto for a human transfer with no matching rules and no hard limits', () => {
    const engine = new EvaluationEngine();
    const result = engine.evaluate(mkMovement(), mkContext(mkPolicy()));
    expect(result.verdict).toBe('allow_auto');
    expect(result.trace.final_verdict_source).toBe('default_deny');
    expect(result.reason_codes).toHaveLength(0);
  });

  it('returns require_approval when a matching rule says so', () => {
    const engine = new EvaluationEngine();
    const policy = mkPolicy({
      rules: [
        {
          id: 'r-1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Approval over $5k',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '>',
            value: { amount: '5000', currency: 'USD' },
          },
          created_by: 'u',
          created_at: new Date(),
        },
      ],
    });
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.verdict).toBe('require_approval');
    expect(result.trace.final_verdict_source).toBe('user_rule');
  });

  it('returns block_hard_limit when a hard limit is breached', () => {
    const engine = new EvaluationEngine();
    const policy = mkPolicy({
      hard_limits: [
        {
          id: 'hl-1',
          limit_type: 'min_cash_reserve_usd',
          name: 'Cash Floor',
          limit_value: '995000',
          limit_currency: 'USD',
          scope: {},
        },
      ],
    });
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.verdict).toBe('block_hard_limit');
    expect(result.trace.final_verdict_source).toBe('hard_limit');
    expect(result.reason_codes).toContain('hard_limit_breached');
  });

  it('promotes AI-initiated allow_auto to require_approval (system invariant)', () => {
    const engine = new EvaluationEngine();
    const policy = mkPolicy({
      rules: [
        {
          id: 'r-1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Small transfers',
          rationale: '',
          priority: 1,
          verdict: 'allow_auto',
          condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '<',
            value: { amount: '100000', currency: 'USD' },
          },
          created_by: 'u',
          created_at: new Date(),
        },
      ],
    });
    const movement = mkMovement({
      initiator: { type: 'ai_recommendation', recommendation_id: 'rec-1' },
    });
    const result = engine.evaluate(movement, mkContext(policy));
    expect(result.verdict).toBe('require_approval');
    expect(
      result.trace.system_invariants_applied.some((i) => i.invariant === 'ai_initiator_floor'),
    ).toBe(true);
    expect(result.trace.final_verdict_source).toBe('system_invariant');
  });

  it('returns block when a rule cannot be fully evaluated', () => {
    const engine = new EvaluationEngine();
    const policy = mkPolicy({
      rules: [
        {
          id: 'r-1',
          version_id: 'v-1',
          rule_type: 'lookahead',
          name: 'Forecast rule',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          condition: {
            kind: 'forecast_query',
            query: 'obligations_covered',
            window_days: 14,
            comparator: '==',
            value: { amount: '1', currency: 'USD' },
          },
          created_by: 'u',
          created_at: new Date(),
        },
      ],
    });
    // Context has no forecast results → rule fails → overall verdict = block
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.verdict).toBe('block');
    expect(result.reason_codes).toContain('forecast_unavailable');
  });

  it('persists canonicalization metadata on the trace', () => {
    const engine = new EvaluationEngine();
    const result = engine.evaluate(mkMovement(), mkContext(mkPolicy()));
    expect(result.trace.canonicalization.rate).toBe('1.0002');
    expect(result.trace.canonicalization.rate_source).toBe('coingecko');
    expect(result.trace.canonicalization.succeeded).toBe(true);
    expect(result.trace.canonicalization.native_amount).toBe('10000');
    expect(result.trace.canonicalization.canonical_amount).toBe('10002');
  });

  it('records all rules evaluated on the trace even if none matched', () => {
    const engine = new EvaluationEngine();
    const policy = mkPolicy({
      rules: [
        {
          id: 'r-1',
          version_id: 'v-1',
          rule_type: 'counterparty',
          name: 'Block sanctioned',
          rationale: '',
          priority: 1,
          verdict: 'block',
          condition: { kind: 'sanctions_status', op: 'in', values: ['sanctioned'] },
          created_by: 'u',
          created_at: new Date(),
        },
        {
          id: 'r-2',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Big transfer approval',
          rationale: '',
          priority: 2,
          verdict: 'require_approval',
          condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '>',
            value: { amount: '100000', currency: 'USD' },
          },
          created_by: 'u',
          created_at: new Date(),
        },
      ],
    });
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.trace.rules_evaluated).toHaveLength(2);
    expect(result.trace.rules_evaluated[0].matched).toBe(false);
    expect(result.trace.rules_evaluated[1].matched).toBe(false);
  });

  it('records hard_limit_check result on the trace (complete for utilization gauges)', () => {
    const engine = new EvaluationEngine();
    const policy = mkPolicy({
      hard_limits: [
        {
          id: 'hl-1',
          limit_type: 'min_cash_reserve_usd',
          name: 'Cash Floor',
          limit_value: '500000',
          limit_currency: 'USD',
          scope: {},
        },
      ],
    });
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.trace.hard_limit_check.evaluated).toHaveLength(1);
    expect(result.trace.hard_limit_check.any_breached).toBe(false);
  });

  it('records evaluation_duration_ms on the trace', () => {
    const engine = new EvaluationEngine();
    const result = engine.evaluate(mkMovement(), mkContext(mkPolicy()));
    expect(typeof result.trace.evaluation_duration_ms).toBe('number');
    expect(result.trace.evaluation_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('rule-matched block does NOT populate reason_codes (trace.rules_evaluated is the source of truth)', () => {
    const engine = new EvaluationEngine();
    const policy = mkPolicy({
      rules: [
        {
          id: 'r-1',
          version_id: 'v-1',
          rule_type: 'counterparty',
          name: 'Always block',
          rationale: 'Test block rule',
          priority: 1,
          verdict: 'block',
          condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '>',
            value: { amount: '0', currency: 'USD' },
          },
          created_by: 'u',
          created_at: new Date(),
        },
      ],
    });
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.verdict).toBe('block');
    expect(result.reason_codes).toHaveLength(0);
    // But the rule DID match — the trace shows it
    expect(result.trace.rules_evaluated[0].matched).toBe(true);
    expect(result.trace.rules_evaluated[0].verdict_contribution).toBe('block');
  });

  it('system_invariants_applied is populated for AI floor, reason_codes is not', () => {
    const engine = new EvaluationEngine();
    const policy = mkPolicy({
      rules: [
        {
          id: 'r-1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Small allow',
          rationale: '',
          priority: 1,
          verdict: 'allow_auto',
          condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '>',
            value: { amount: '0', currency: 'USD' },
          },
          created_by: 'u',
          created_at: new Date(),
        },
      ],
    });
    const movement = mkMovement({
      initiator: { type: 'agent', agent_id: 'agent-1' },
    });
    const result = engine.evaluate(movement, mkContext(policy));
    expect(result.verdict).toBe('require_approval');
    expect(result.trace.system_invariants_applied).toHaveLength(1);
    expect(result.trace.system_invariants_applied[0].invariant).toBe('ai_initiator_floor');
    // Invariants aren't duplicated into reason_codes
    expect(result.reason_codes).toHaveLength(0);
  });

  it('forecast_mode is persisted from the context', () => {
    const engine = new EvaluationEngine();
    const result = engine.evaluate(mkMovement(), mkContext(mkPolicy()));
    expect(result.trace.forecast_mode).toBe('stub');
  });

  it('engine_version is stamped on the trace', () => {
    const engine = new EvaluationEngine();
    const result = engine.evaluate(mkMovement(), mkContext(mkPolicy()));
    expect(result.trace.engine_version).toBe('1.0.0');
  });

  it('required_chain is NOT populated (phase-1 gap — Plan 2 wires chain resolution)', () => {
    const engine = new EvaluationEngine();
    const policy = mkPolicy({
      rules: [
        {
          id: 'r-1',
          version_id: 'v-1',
          rule_type: 'approval_threshold',
          name: 'Always require',
          rationale: '',
          priority: 1,
          verdict: 'require_approval',
          condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '>',
            value: { amount: '0', currency: 'USD' },
          },
          created_by: 'u',
          created_at: new Date(),
        },
      ],
    });
    const result = engine.evaluate(mkMovement(), mkContext(policy));
    expect(result.verdict).toBe('require_approval');
    expect(result.required_chain).toBeUndefined();
  });
});
