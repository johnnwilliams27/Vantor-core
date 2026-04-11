// src/lib/policy/__fixtures__/policy-versions.ts

import { PolicyVersionSnapshot } from '../types/policy-version';

export function emptyPolicy(
  overrides: Partial<PolicyVersionSnapshot> = {},
): PolicyVersionSnapshot {
  return {
    id: 'v-fixture-empty',
    enterprise_id: 'ent-fixture-1',
    version_number: 1,
    status: 'active',
    name: 'Empty Policy (fixture)',
    rules: [],
    hard_limits: [],
    approval_chains: [],
    ...overrides,
  };
}

export function standardPolicy(
  overrides: Partial<PolicyVersionSnapshot> = {},
): PolicyVersionSnapshot {
  const now = new Date('2026-04-10T14:22:33.000Z');
  return {
    id: 'v-fixture-standard',
    enterprise_id: 'ent-fixture-1',
    version_number: 1,
    status: 'active',
    name: 'Standard Controls (fixture)',
    rules: [
      {
        id: 'r-approval-50k',
        version_id: 'v-fixture-standard',
        rule_type: 'approval_threshold',
        name: 'Approval over $50,000',
        rationale: 'Standard wire approval threshold',
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '50000', currency: 'USD' },
        },
        verdict: 'require_approval',
        priority: 100,
        created_by: 'user-fixture-admin',
        created_at: now,
      },
      {
        id: 'r-block-sanctioned',
        version_id: 'v-fixture-standard',
        rule_type: 'counterparty',
        name: 'Block sanctioned counterparties',
        rationale: 'OFAC / compliance blocking',
        condition: {
          kind: 'sanctions_status',
          op: 'in',
          values: ['sanctioned', 'partial_match'],
        },
        verdict: 'block',
        priority: 10,
        created_by: 'user-fixture-admin',
        created_at: now,
      },
    ],
    hard_limits: [
      {
        id: 'hl-cash-floor',
        limit_type: 'min_cash_reserve_usd',
        name: 'Operating Cash Floor',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
      },
      {
        id: 'hl-concentration',
        limit_type: 'max_single_asset_concentration_pct',
        name: 'Max Asset Concentration',
        limit_value: '70',
        scope: {},
      },
    ],
    approval_chains: [],
    ...overrides,
  };
}
