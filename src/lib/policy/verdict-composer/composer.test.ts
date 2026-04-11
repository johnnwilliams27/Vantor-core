import { describe, it, expect } from 'vitest';
import { composeVerdict } from './composer';
import { Verdict } from '../types/verdict';
import { ProposedMovement, Initiator } from '../types/movement';
import { RuleEvaluationTrace } from '../types/trace';

const mkInitiator = (
  type: 'human' | 'agent' | 'ai_recommendation' | 'schedule',
): Initiator => {
  switch (type) {
    case 'human':
      return { type: 'human', user_id: 'user-1' };
    case 'agent':
      return { type: 'agent', agent_id: 'agent-1' };
    case 'ai_recommendation':
      return { type: 'ai_recommendation', recommendation_id: 'rec-1' };
    case 'schedule':
      return { type: 'schedule', scheduled_op_id: 'op-1' };
  }
};

const mkMovement = (
  initiatorType: 'human' | 'agent' | 'ai_recommendation' | 'schedule' = 'human',
): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'external', asset: 'USDC' },
  amount: { amount: '10000', asset: 'USDC' },
  initiator: mkInitiator(initiatorType),
  requested_at: new Date().toISOString(),
});

let traceIdCounter = 0;
const mkRuleTrace = (
  verdict: Verdict | null,
  matched: boolean,
  failure?: RuleEvaluationTrace['failure'],
): RuleEvaluationTrace => ({
  rule_id: `r-${traceIdCounter++}`,
  rule_name: 'Test',
  rule_type: 'approval_threshold',
  priority: 1,
  condition_result: {
    path: [],
    node_kind: 'amount_compare',
    result: matched ? 'matched' : 'not_matched',
  },
  matched,
  verdict_contribution: verdict,
  failure,
});

describe('composeVerdict — hard limit precedence', () => {
  it('hard limit breach forces block_hard_limit regardless of user rules', () => {
    const rules = [mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('human'), rules, true);
    expect(result.verdict).toBe('block_hard_limit');
    expect(result.source).toBe('hard_limit');
  });

  it('hard limit breach wins even when a rule says block (terminal)', () => {
    const rules = [mkRuleTrace('block', true)];
    const result = composeVerdict(mkMovement('human'), rules, true);
    expect(result.verdict).toBe('block_hard_limit');
  });

  it('hard limit breach wins even when NO rules matched', () => {
    const result = composeVerdict(mkMovement('human'), [], true);
    expect(result.verdict).toBe('block_hard_limit');
  });
});

describe('composeVerdict — failed rules', () => {
  it('returns block when ANY rule failed to evaluate (cannot-fully-evaluate)', () => {
    const rules = [
      mkRuleTrace('allow_auto', true),
      mkRuleTrace(null, false, {
        reason_code: 'forecast_unavailable',
        human_readable: 'Forecast down',
        details: {},
        affected_condition_path: [],
      }),
    ];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('block');
    expect(result.source).toBe('user_rule');
  });

  it('returns block even for human initiator when a rule failed', () => {
    const rules = [
      mkRuleTrace(null, false, {
        reason_code: 'aggregate_query_failed',
        human_readable: 'Query timed out',
        details: {},
        affected_condition_path: [],
      }),
    ];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('block');
  });
});

describe('composeVerdict — lowest privilege wins', () => {
  it('block > require_approval > allow_auto', () => {
    const rules = [
      mkRuleTrace('allow_auto', true),
      mkRuleTrace('require_approval', true),
      mkRuleTrace('block', true),
    ];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('block');
  });

  it('require_approval > allow_auto', () => {
    const rules = [mkRuleTrace('allow_auto', true), mkRuleTrace('require_approval', true)];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('require_approval');
  });

  it('multiple allow_auto rules → allow_auto (for humans)', () => {
    const rules = [mkRuleTrace('allow_auto', true), mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('allow_auto');
  });

  it('non-matching rules are ignored in the composition', () => {
    const rules = [
      mkRuleTrace('block', false), // did not match
      mkRuleTrace('allow_auto', true),
    ];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('allow_auto');
  });

  it('defense-in-depth: block_hard_limit contribution from a user rule is treated as block', () => {
    // A rule should never contribute block_hard_limit (that's the hard-limit
    // checker's domain), but if one somehow does, we must not silently fall
    // through to allow_auto. This is a type-system guard — schema should
    // prevent authoring this in the first place.
    const rules = [mkRuleTrace('block_hard_limit', true), mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('block');
  });
});

describe('composeVerdict — AI initiator floor', () => {
  it('promotes allow_auto → require_approval for ai_recommendation initiator', () => {
    const rules = [mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('ai_recommendation'), rules, false);
    expect(result.verdict).toBe('require_approval');
    expect(result.source).toBe('system_invariant');
    expect(result.invariants_applied.some((i) => i.invariant === 'ai_initiator_floor')).toBe(true);
    expect(result.invariants_applied[0].warning_code).toBe('ai_initiator_floor_applied');
  });

  it('promotes allow_auto → require_approval for agent initiator', () => {
    const rules = [mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('agent'), rules, false);
    expect(result.verdict).toBe('require_approval');
    expect(result.invariants_applied.some((i) => i.invariant === 'ai_initiator_floor')).toBe(true);
  });

  it('does NOT apply the AI floor for human initiator', () => {
    const rules = [mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('allow_auto');
    expect(result.invariants_applied).toHaveLength(0);
  });

  it('does NOT apply the AI floor for schedule initiator (schedule gets default deny instead)', () => {
    const rules = [mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('schedule'), rules, false);
    // schedule with an allow_auto match: the allow_auto composes, the AI
    // floor does NOT trigger (schedule isn't autonomous in the AI sense).
    // Schedule-initiated with an explicit allow → allow_auto.
    expect(result.verdict).toBe('allow_auto');
  });

  it('AI floor does NOT apply when the composed verdict is already require_approval or block', () => {
    const rules = [mkRuleTrace('require_approval', true)];
    const result = composeVerdict(mkMovement('ai_recommendation'), rules, false);
    expect(result.verdict).toBe('require_approval');
    // Source is 'user_rule' because the rule itself said require_approval;
    // the AI floor didn't need to apply
    expect(result.source).toBe('user_rule');
    expect(result.invariants_applied.some((i) => i.invariant === 'ai_initiator_floor')).toBe(
      false,
    );
  });
});

describe('composeVerdict — default deny for non-humans', () => {
  it('defaults to require_approval for agent initiator with no matching rules', () => {
    const result = composeVerdict(mkMovement('agent'), [], false);
    expect(result.verdict).toBe('require_approval');
    expect(result.source).toBe('system_invariant');
    expect(result.invariants_applied.some((i) => i.invariant === 'default_deny')).toBe(true);
  });

  it('defaults to require_approval for ai_recommendation initiator with no matching rules', () => {
    const result = composeVerdict(mkMovement('ai_recommendation'), [], false);
    expect(result.verdict).toBe('require_approval');
    expect(result.invariants_applied.some((i) => i.invariant === 'default_deny')).toBe(true);
  });

  it('defaults to require_approval for schedule initiator with no matching rules', () => {
    const result = composeVerdict(mkMovement('schedule'), [], false);
    expect(result.verdict).toBe('require_approval');
    expect(result.invariants_applied.some((i) => i.invariant === 'default_deny')).toBe(true);
  });

  it('default deny applies when rules exist but none matched', () => {
    const rules = [mkRuleTrace('allow_auto', false)]; // rule exists but did not match
    const result = composeVerdict(mkMovement('schedule'), rules, false);
    expect(result.verdict).toBe('require_approval');
    expect(result.invariants_applied.some((i) => i.invariant === 'default_deny')).toBe(true);
  });
});

describe('composeVerdict — edge cases and hardening', () => {
  it('hard limit breach wins even when combined with failed rules and ai_recommendation initiator', () => {
    const rules = [
      mkRuleTrace(null, false, {
        reason_code: 'forecast_unavailable',
        human_readable: 'Forecast down',
        details: {},
        affected_condition_path: [],
      }),
    ];
    const result = composeVerdict(mkMovement('ai_recommendation'), rules, true);
    expect(result.verdict).toBe('block_hard_limit');
    expect(result.source).toBe('hard_limit');
  });

  it('schedule + matching allow_auto: no invariants applied (not default_deny, not AI floor)', () => {
    const rules = [mkRuleTrace('allow_auto', true)];
    const result = composeVerdict(mkMovement('schedule'), rules, false);
    expect(result.verdict).toBe('allow_auto');
    expect(result.invariants_applied).toHaveLength(0);
  });

  it('schedule + matching block: returns block with source user_rule (not default_deny)', () => {
    const rules = [mkRuleTrace('block', true)];
    const result = composeVerdict(mkMovement('schedule'), rules, false);
    expect(result.verdict).toBe('block');
    expect(result.source).toBe('user_rule');
    expect(result.invariants_applied).toHaveLength(0);
  });

  it('all matching rules with verdict_contribution=null (matched but no-op) falls through to defaults', () => {
    const rules = [mkRuleTrace(null, true), mkRuleTrace(null, true)];
    // Human: should fall through to allow_auto
    const humanResult = composeVerdict(mkMovement('human'), rules, false);
    expect(humanResult.verdict).toBe('allow_auto');

    // AI: should fall through to default_deny → require_approval
    const aiResult = composeVerdict(mkMovement('ai_recommendation'), rules, false);
    expect(aiResult.verdict).toBe('require_approval');
    expect(aiResult.invariants_applied.some((i) => i.invariant === 'default_deny')).toBe(true);
  });

  it('defense-in-depth: unknown verdict_contribution value on a matched rule → block', () => {
    // Runtime data corruption or type bypass produces an unknown Verdict
    // value. Must not fall through to allow_auto for humans.
    const rules = [mkRuleTrace('mystery_verdict' as unknown as Verdict, true)];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('block');
    expect(result.source).toBe('user_rule');
  });
});

describe('composeVerdict — human default allow', () => {
  it('defaults to allow_auto for human initiator with no matching rules', () => {
    const result = composeVerdict(mkMovement('human'), [], false);
    expect(result.verdict).toBe('allow_auto');
    expect(result.invariants_applied).toHaveLength(0);
  });

  it('defaults to allow_auto for human with rules that all did not match', () => {
    const rules = [mkRuleTrace('block', false), mkRuleTrace('require_approval', false)];
    const result = composeVerdict(mkMovement('human'), rules, false);
    expect(result.verdict).toBe('allow_auto');
  });
});
