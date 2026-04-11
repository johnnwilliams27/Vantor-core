import { describe, it, expect } from 'vitest';
import { EvaluationEngine } from './evaluator';
import {
  humanUsdcTransfer,
  aiRecommendedRebalance,
  largeHumanWire,
  scheduledYieldDeposit,
} from '../__fixtures__/movements';
import { healthyContext, successfulCanonicalization } from '../__fixtures__/contexts';
import { standardPolicy, emptyPolicy } from '../__fixtures__/policy-versions';

describe('Engine integration — full pipeline', () => {
  const engine = new EvaluationEngine();

  it('a $10k human USDC transfer under the standard policy auto-executes', () => {
    const movement = humanUsdcTransfer();
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      canonicalization: successfulCanonicalization('10000', 'USDC', '10002'),
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('allow_auto');
    expect(result.trace.hard_limit_check.any_breached).toBe(false);
    expect(result.trace.rules_evaluated).toHaveLength(2);
  });

  it('a $500k human wire under the standard policy requires approval', () => {
    const movement = largeHumanWire();
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      canonicalization: successfulCanonicalization('500000', 'USD', '500000'),
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('require_approval');
    // Rule r-approval-50k should have matched
    const approvalRule = result.trace.rules_evaluated.find((r) => r.rule_id === 'r-approval-50k');
    expect(approvalRule?.matched).toBe(true);
  });

  it('a transfer to a sanctioned counterparty is blocked', () => {
    const movement = humanUsdcTransfer({ counterparty: { id: 'cp-bad' } });
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      sanctions: {
        counterparty_id: 'cp-bad',
        status: 'sanctioned',
        screened_at: new Date(),
      },
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('block');
    const sanctionsRule = result.trace.rules_evaluated.find(
      (r) => r.rule_id === 'r-block-sanctioned',
    );
    expect(sanctionsRule?.matched).toBe(true);
  });

  it('an AI-initiated $1000 swap is held for approval due to system invariant', () => {
    const movement = aiRecommendedRebalance({ amount: { amount: '1000', asset: 'USDC' } });
    const ctx = healthyContext({
      policy_version: emptyPolicy(), // no user rules
      canonicalization: successfulCanonicalization('1000', 'USDC', '1000.2'),
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('require_approval');
    // Either ai_initiator_floor (if rules allowed) or default_deny (empty policy)
    // Empty policy → default_deny invariant fires
    expect(result.trace.system_invariants_applied.some((i) => i.invariant === 'default_deny')).toBe(
      true,
    );
  });

  it('a scheduled yield deposit with no matching allow rule is held (default deny)', () => {
    const movement = scheduledYieldDeposit();
    const ctx = healthyContext({
      policy_version: emptyPolicy(),
      canonicalization: successfulCanonicalization('250000', 'USDC', '250050'),
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('require_approval');
    expect(result.trace.system_invariants_applied.some((i) => i.invariant === 'default_deny')).toBe(
      true,
    );
  });

  it('a transfer that would drop cash below the floor is block_hard_limit', () => {
    // 7.6M outflow from a 8M cash treasury leaves 400k, below the 500k floor.
    // This also breaches the concentration limit (USDT 2M / 400k post-total = 500%),
    // so we get two hard limit breaches. Assert the cash floor is one of them.
    const movement = largeHumanWire({ amount: { amount: '7600000', asset: 'USD' } });
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      canonicalization: successfulCanonicalization('7600000', 'USD', '7600000'),
    });
    const result = engine.evaluate(movement, ctx);
    expect(result.verdict).toBe('block_hard_limit');
    expect(result.trace.final_verdict_source).toBe('hard_limit');
    expect(result.trace.hard_limit_check.breaches.length).toBeGreaterThanOrEqual(1);
    const cashFloorBreach = result.trace.hard_limit_check.breaches.find(
      (b) => b.limit_name === 'Operating Cash Floor',
    );
    expect(cashFloorBreach).toBeDefined();
  });

  it('splitting guard matches when 24h rolling sum + proposed exceeds threshold', () => {
    const movement = humanUsdcTransfer({ amount: { amount: '5000', asset: 'USDC' } });
    const ctx = healthyContext({
      policy_version: standardPolicy(),
      canonicalization: successfulCanonicalization('5000', 'USDC', '5001'),
      aggregates: {
        system_splitting_guard_24h: {
          window_spec_hash: 'sys',
          window_start: new Date('2026-04-09T14:22:33.000Z'),
          window_end: new Date('2026-04-10T14:22:33.000Z'),
          sum_amount_usd: '48000', // already $48k in trailing 24h
          sum_amount_by_asset: {},
          count: 9,
          distinct_destinations: 1,
          distinct_counterparties: 1,
          included_evaluation_ids: [],
          includes_proposed: false,
        },
        user_specs: {},
      },
    });
    const result = engine.evaluate(movement, ctx);
    // Direct amount 5001 USD < 50000 threshold — direct fails.
    // Rolling + proposed = 53001 > 50000 — splitting matches.
    expect(result.verdict).toBe('require_approval');
    const rule50k = result.trace.rules_evaluated.find((r) => r.rule_id === 'r-approval-50k');
    expect(rule50k?.matched).toBe(true);
    expect(rule50k?.matched_via).toBe('splitting');
  });

  it('trace includes forecast_mode and stub warning', () => {
    const movement = humanUsdcTransfer();
    const ctx = healthyContext({ policy_version: standardPolicy() });
    const result = engine.evaluate(movement, ctx);
    expect(result.trace.forecast_mode).toBe('stub');
    expect(result.trace.forecast_warnings.some((w) => w.includes('STUB'))).toBe(true);
  });

  it('trace is complete — every Plan 2 consumer can reconstruct the decision', () => {
    const movement = humanUsdcTransfer();
    const ctx = healthyContext({ policy_version: standardPolicy() });
    const result = engine.evaluate(movement, ctx);

    // Structural completeness of the trace
    expect(result.trace.engine_version).toBe('1.0.0');
    expect(result.trace.policy_version_id).toBe('v-fixture-standard');
    expect(result.trace.policy_version_number).toBe(1);
    expect(result.trace.proposed_movement_id).toBe('mv-fixture-human-usdc');
    expect(result.trace.canonicalization).toBeDefined();
    expect(result.trace.canonicalization.succeeded).toBe(true);
    expect(result.trace.hard_limit_check).toBeDefined();
    expect(result.trace.rules_evaluated).toBeDefined();
    expect(result.trace.system_invariants_applied).toBeDefined();
    expect(result.trace.final_verdict).toBe(result.verdict);
    expect(result.trace.final_verdict_source).toBeDefined();
    expect(result.trace.final_verdict_reasons).toBeDefined();
    expect(typeof result.trace.evaluation_duration_ms).toBe('number');
  });
});
