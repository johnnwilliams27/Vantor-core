import { describe, it, expect } from 'vitest';
import {
  validateRuleInput,
  validateHardLimitInput,
  validateApprovalChainInput,
  validateVersionCoherent,
} from './validation';
import { AuthoringError } from './errors';
import type {
  UpsertRuleRequest,
  UpsertHardLimitRequest,
  UpsertApprovalChainRequest,
} from './types';
import type { PolicyVersionSnapshot } from '../types/policy-version';

const mkValidRule = (overrides: Partial<UpsertRuleRequest> = {}): UpsertRuleRequest => ({
  rule_type: 'approval_threshold',
  name: 'Approval over $50k',
  rationale: 'Standard wire approval threshold',
  condition: {
    kind: 'amount_compare',
    attr: 'transfer.amount',
    op: '>',
    value: { amount: '50000', currency: 'USD' },
  },
  verdict: 'require_approval',
  verdict_chain_id: 'chain-1',
  priority: 100,
  ...overrides,
});

const mkValidHardLimit = (
  overrides: Partial<UpsertHardLimitRequest> = {},
): UpsertHardLimitRequest => ({
  limit_type: 'min_cash_reserve_usd',
  name: 'Operating Cash Floor',
  limit_value: '500000',
  limit_currency: 'USD',
  scope: {},
  ...overrides,
});

const mkEmptyVersion = (): PolicyVersionSnapshot => ({
  id: 'v-1',
  enterprise_id: 'ent-1',
  version_number: 1,
  status: 'draft',
  name: 'Draft',
  rules: [],
  hard_limits: [],
  approval_chains: [],
});

describe('validateRuleInput — schema parse + IR checks', () => {
  it('accepts a well-formed rule', () => {
    expect(() => validateRuleInput(mkValidRule())).not.toThrow();
  });

  it('rejects a rule with missing condition field', () => {
    const bad = { ...mkValidRule(), condition: undefined as unknown as never };
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a rule with non-integer priority', () => {
    const bad = mkValidRule({ priority: 1.5 });
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a rule with empty name', () => {
    const bad = mkValidRule({ name: '' });
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a require_approval rule without verdict_chain_id (default behavior)', () => {
    const bad = mkValidRule({ verdict: 'require_approval', verdict_chain_id: undefined });
    // Default requireChainForApproval is true
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
  });

  it('accepts a require_approval rule WITH verdict_chain_id', () => {
    const good = mkValidRule({ verdict: 'require_approval', verdict_chain_id: 'chain-1' });
    expect(() => validateRuleInput(good)).not.toThrow();
  });

  it('allows skipping chain check when requireChainForApproval=false', () => {
    const rule = mkValidRule({ verdict: 'require_approval', verdict_chain_id: undefined });
    expect(() =>
      validateRuleInput(rule, { requireChainForApproval: false }),
    ).not.toThrow();
  });
});

describe('validateRuleInput — currency consistency (usd_rule_on_rateless_asset)', () => {
  it('rejects a USD rule on a non-stablecoin asset when currency=USD and scope has rateless asset', () => {
    const bad = mkValidRule({
      condition: {
        kind: 'amount_compare',
        attr: 'treasury.position',
        scope: { asset: 'BTC' as never },
        op: '>',
        value: { amount: '100', currency: 'USD' },
      },
    });
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
    try {
      validateRuleInput(bad);
    } catch (err) {
      expect((err as AuthoringError).reason_code).toBe('usd_rule_on_rateless_asset');
    }
  });
});

describe('validateHardLimitInput', () => {
  it('accepts a well-formed hard limit', () => {
    expect(() => validateHardLimitInput(mkValidHardLimit())).not.toThrow();
  });

  it('rejects a hard limit with negative limit_value', () => {
    const bad = mkValidHardLimit({ limit_value: '-500000' });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a hard limit with limit_value=0 for min_cash_reserve_usd', () => {
    const bad = mkValidHardLimit({ limit_value: '0' });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
  });

  it('rejects a max_native_exposure limit without scope.asset', () => {
    const bad = mkValidHardLimit({
      limit_type: 'max_native_exposure',
      limit_value: '1000000',
      limit_currency: undefined,
      scope: {},
    });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
    try {
      validateHardLimitInput(bad);
    } catch (err) {
      expect((err as AuthoringError).reason_code).toBe('hard_limit_value_out_of_range');
    }
  });

  it('rejects max_single_asset_concentration_pct > 100', () => {
    const bad = mkValidHardLimit({
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '150',
      limit_currency: undefined,
    });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
  });

  it('rejects obligation_coverage_days with non-integer value', () => {
    const bad = mkValidHardLimit({
      limit_type: 'obligation_coverage_days',
      limit_value: '14.5',
      limit_currency: undefined,
    });
    expect(() => validateHardLimitInput(bad)).toThrow(AuthoringError);
  });
});

describe('validateApprovalChainInput', () => {
  it('accepts a chain with at least one slot', () => {
    const chain: UpsertApprovalChainRequest = {
      name: 'Single approver',
      slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
      priority: 1,
      expiration_hours: 48,
    };
    expect(() => validateApprovalChainInput(chain)).not.toThrow();
  });

  it('rejects a chain with zero slots', () => {
    const chain: UpsertApprovalChainRequest = {
      name: 'Empty chain',
      slots: [],
      priority: 1,
    };
    expect(() => validateApprovalChainInput(chain)).toThrow(AuthoringError);
  });

  it('rejects a chain with duplicate slot_index values', () => {
    const chain: UpsertApprovalChainRequest = {
      name: 'Dup slots',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 0, minimum_role: 'executive' },
      ],
      priority: 1,
    };
    expect(() => validateApprovalChainInput(chain)).toThrow(AuthoringError);
  });

  it('rejects a chain with non-sequential slot_index values (0, 2 is invalid)', () => {
    const chain: UpsertApprovalChainRequest = {
      name: 'Gap',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 2, minimum_role: 'executive' },
      ],
      priority: 1,
    };
    expect(() => validateApprovalChainInput(chain)).toThrow(AuthoringError);
  });
});

describe('validateVersionCoherent — whole-version checks', () => {
  it('accepts a version with no rules/limits/chains (empty draft is valid)', () => {
    expect(() => validateVersionCoherent(mkEmptyVersion())).not.toThrow();
  });

  it('rejects a version with duplicate rule priorities', () => {
    const v = mkEmptyVersion();
    v.rules = [
      {
        id: 'r1',
        version_id: 'v-1',
        rule_type: 'approval_threshold',
        name: 'A',
        rationale: '',
        priority: 100,
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '1', currency: 'USD' },
        },
        verdict: 'require_approval',
        created_by: 'u',
        created_at: new Date(),
      },
      {
        id: 'r2',
        version_id: 'v-1',
        rule_type: 'approval_threshold',
        name: 'B',
        rationale: '',
        priority: 100,
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '2', currency: 'USD' },
        },
        verdict: 'block',
        created_by: 'u',
        created_at: new Date(),
      },
    ];
    expect(() => validateVersionCoherent(v)).toThrow(AuthoringError);
    try {
      validateVersionCoherent(v);
    } catch (err) {
      expect((err as AuthoringError).reason_code).toBe('rule_priority_collision');
    }
  });

  it('rejects a rule with verdict=require_approval referencing a non-existent chain', () => {
    const v = mkEmptyVersion();
    v.rules = [
      {
        id: 'r1',
        version_id: 'v-1',
        rule_type: 'approval_threshold',
        name: 'A',
        rationale: '',
        priority: 100,
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '1', currency: 'USD' },
        },
        verdict: 'require_approval',
        verdict_chain_id: 'chain-does-not-exist',
        created_by: 'u',
        created_at: new Date(),
      },
    ];
    expect(() => validateVersionCoherent(v)).toThrow(AuthoringError);
    try {
      validateVersionCoherent(v);
    } catch (err) {
      expect((err as AuthoringError).reason_code).toBe('chain_reference_not_found');
    }
  });

  it('accepts a rule with verdict=require_approval referencing an existing chain', () => {
    const v = mkEmptyVersion();
    v.approval_chains = [
      {
        id: 'chain-1',
        version_id: 'v-1',
        name: 'Single',
        slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
        priority: 1,
        expiration_hours: 48,
        created_by: 'u',
        created_at: new Date(),
      },
    ];
    v.rules = [
      {
        id: 'r1',
        version_id: 'v-1',
        rule_type: 'approval_threshold',
        name: 'A',
        rationale: '',
        priority: 100,
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '1', currency: 'USD' },
        },
        verdict: 'require_approval',
        verdict_chain_id: 'chain-1',
        created_by: 'u',
        created_at: new Date(),
      },
    ];
    expect(() => validateVersionCoherent(v)).not.toThrow();
  });
});

// ─── Adversarial review hardening tests ───────────────────────────────

describe('adversarial: C1 — unknown limit_type rejected at runtime', () => {
  it('rejects a fabricated limit_type string', () => {
    expect(() =>
      validateHardLimitInput({
        limit_type: 'max_weekly_outflow_btc' as never,
        name: 'Sneaky',
        limit_value: '100',
        limit_currency: undefined,
        scope: {},
      }),
    ).toThrow(AuthoringError);
  });
});

describe('adversarial: C2 — cross-stablecoin currency mismatch rejected', () => {
  it('rejects USDC threshold on USDT-scoped position', () => {
    const bad = mkValidRule({
      condition: {
        kind: 'amount_compare',
        attr: 'treasury.position',
        scope: { asset: 'USDT' },
        op: '>',
        value: { amount: '50000', currency: 'USDC' },
      },
    });
    expect(() => validateRuleInput(bad)).toThrow(AuthoringError);
    try {
      validateRuleInput(bad);
    } catch (err) {
      expect((err as AuthoringError).reason_code).toBe('native_unit_currency_mismatch');
    }
  });

  it('accepts USD threshold on USDT-scoped position', () => {
    const good = mkValidRule({
      condition: {
        kind: 'amount_compare',
        attr: 'treasury.position',
        scope: { asset: 'USDT' },
        op: '>',
        value: { amount: '50000', currency: 'USD' },
      },
    });
    expect(() => validateRuleInput(good)).not.toThrow();
  });

  it('accepts same-asset threshold on scoped position', () => {
    const good = mkValidRule({
      condition: {
        kind: 'amount_compare',
        attr: 'treasury.position',
        scope: { asset: 'USDC' },
        op: '>',
        value: { amount: '50000', currency: 'USDC' },
      },
    });
    expect(() => validateRuleInput(good)).not.toThrow();
  });
});

describe('adversarial: I2 — invalid minimum_role on chain slot rejected', () => {
  it('rejects empty string minimum_role', () => {
    expect(() =>
      validateApprovalChainInput({
        name: 'Backdoor chain',
        slots: [{ slot_index: 0, minimum_role: '' as never }],
        priority: 1,
      }),
    ).toThrow(AuthoringError);
  });

  it('rejects fabricated minimum_role', () => {
    expect(() =>
      validateApprovalChainInput({
        name: 'God mode',
        slots: [{ slot_index: 0, minimum_role: 'superadmin' as never }],
        priority: 1,
      }),
    ).toThrow(AuthoringError);
  });
});

describe('adversarial: I5 — Infinity limit_value rejected', () => {
  it('rejects extremely large numeric string that parseFloat converts to Infinity', () => {
    expect(() =>
      validateHardLimitInput({
        limit_type: 'min_cash_reserve_usd',
        name: 'Block everything',
        limit_value: '9'.repeat(400),
        limit_currency: 'USD',
        scope: {},
      }),
    ).toThrow(AuthoringError);
  });
});

describe('adversarial: N1 — duplicate hard limit detection', () => {
  it('rejects two hard limits of the same type and scope', () => {
    const v = mkEmptyVersion();
    v.hard_limits = [
      { id: 'hl-1', limit_type: 'min_cash_reserve_usd', name: 'A', limit_value: '500000', limit_currency: 'USD', scope: {} },
      { id: 'hl-2', limit_type: 'min_cash_reserve_usd', name: 'B', limit_value: '600000', limit_currency: 'USD', scope: {} },
    ];
    expect(() => validateVersionCoherent(v)).toThrow(AuthoringError);
  });
});

// ─── Chain-size guardrails ──────────────────────────────────────────────────
// See CHAIN_SIZE_THRESHOLDS in validation.ts. These live in
// validateVersionCoherent because the check needs both rules and chains.

import { maxUsdAmountThreshold, CHAIN_SIZE_THRESHOLDS } from './validation';
import type { Condition } from '../types/ir';

function mkChain(
  overrides: Partial<PolicyVersionSnapshot['approval_chains'][number]>,
): PolicyVersionSnapshot['approval_chains'][number] {
  return {
    id: 'chain-1',
    version_id: 'v-1',
    name: 'Default Chain',
    slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
    priority: 0,
    expiration_hours: 24,
    created_by: 'user-1',
    created_at: new Date(),
    ...overrides,
  };
}

function mkRule(
  overrides: Partial<PolicyVersionSnapshot['rules'][number]>,
): PolicyVersionSnapshot['rules'][number] {
  return {
    id: 'rule-1',
    version_id: 'v-1',
    rule_type: 'approval_threshold',
    name: 'High-value rule',
    rationale: '',
    condition: {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '100', currency: 'USD' },
    },
    verdict: 'require_approval',
    verdict_chain_id: 'chain-1',
    priority: 1,
    created_by: 'user-1',
    created_at: new Date(),
    ...overrides,
  };
}

describe('maxUsdAmountThreshold — condition tree walker', () => {
  it('extracts the threshold from a flat amount_compare node', () => {
    const cond: Condition = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '500000', currency: 'USD' },
    };
    expect(maxUsdAmountThreshold(cond)).toBe(500_000);
  });

  it('returns 0 for non-amount conditions', () => {
    const cond: Condition = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: '==',
      value: 'abc',
    };
    expect(maxUsdAmountThreshold(cond)).toBe(0);
  });

  it('ignores non-USD amount thresholds', () => {
    const cond: Condition = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    expect(maxUsdAmountThreshold(cond)).toBe(0);
  });

  it('ignores amount comparisons that are not > or >=', () => {
    // A < comparison means "rule fires below threshold" — not a high-value
    // guard; should not contribute to the max.
    const cond: Condition = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '<',
      value: { amount: '500000', currency: 'USD' },
    };
    expect(maxUsdAmountThreshold(cond)).toBe(0);
  });

  it('walks AND trees and returns the max threshold across branches', () => {
    const cond: Condition = {
      kind: 'and',
      children: [
        { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '100', currency: 'USD' } },
        { kind: 'amount_compare', attr: 'transfer.amount', op: '>=', value: { amount: '1000000', currency: 'USD' } },
      ],
    };
    expect(maxUsdAmountThreshold(cond)).toBe(1_000_000);
  });

  it('walks OR and NOT nodes', () => {
    const cond: Condition = {
      kind: 'or',
      children: [
        { kind: 'not', child: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '750000', currency: 'USD' } } },
        { kind: 'string_compare', attr: 'transfer.rail', op: '==', value: 'wire' },
      ],
    };
    // Recurses through `not` — conservative: we capture any amount the
    // author wrote, even under negation. Flagging is safer than missing.
    expect(maxUsdAmountThreshold(cond)).toBe(750_000);
  });
});

describe('validateVersionCoherent — chain-size guardrails', () => {
  it('rejects a $500K rule routing to a single-slot chain', () => {
    const v = mkEmptyVersion();
    v.approval_chains = [mkChain({ id: 'chain-1', slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }] })];
    v.rules = [mkRule({
      condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: String(CHAIN_SIZE_THRESHOLDS.DUAL_APPROVAL_USD), currency: 'USD' } },
    })];
    expect(() => validateVersionCoherent(v)).toThrow(/chain_insufficient_slots_for_amount|dual approval/i);
  });

  it('accepts a $500K rule routing to a two-slot chain', () => {
    const v = mkEmptyVersion();
    v.approval_chains = [mkChain({
      id: 'chain-1',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
    })];
    v.rules = [mkRule({
      condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>=', value: { amount: '500000', currency: 'USD' } },
    })];
    expect(() => validateVersionCoherent(v)).not.toThrow();
  });

  it('rejects a $1M rule routing to a two-slot chain without an executive slot', () => {
    const v = mkEmptyVersion();
    v.approval_chains = [mkChain({
      id: 'chain-1',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
    })];
    v.rules = [mkRule({
      condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: String(CHAIN_SIZE_THRESHOLDS.EXECUTIVE_REQUIRED_USD), currency: 'USD' } },
    })];
    expect(() => validateVersionCoherent(v)).toThrow(/chain_missing_executive_slot_for_amount|executive/i);
  });

  it('accepts a $1M rule routing to a chain with an executive slot', () => {
    const v = mkEmptyVersion();
    v.approval_chains = [mkChain({
      id: 'chain-1',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 1, minimum_role: 'executive' },
      ],
    })];
    v.rules = [mkRule({
      condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>=', value: { amount: '1000000', currency: 'USD' } },
    })];
    expect(() => validateVersionCoherent(v)).not.toThrow();
  });

  it('ignores non-USD amount thresholds (guardrail is USD-denominated)', () => {
    // A rule gating on 500K USDC (a stablecoin) shouldn't trigger the
    // guardrail — USD-only for now. If we ever extend to other fiat
    // equivalents this test needs updating.
    const v = mkEmptyVersion();
    v.approval_chains = [mkChain({ slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }] })];
    v.rules = [mkRule({
      condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '500000', currency: 'USDC' } },
    })];
    expect(() => validateVersionCoherent(v)).not.toThrow();
  });

  it('leaves rules that do not require approval unaffected', () => {
    const v = mkEmptyVersion();
    v.approval_chains = [mkChain({ slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }] })];
    v.rules = [mkRule({
      verdict: 'allow_auto',
      verdict_chain_id: undefined,
      condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '5000000', currency: 'USD' } },
    })];
    expect(() => validateVersionCoherent(v)).not.toThrow();
  });
});
