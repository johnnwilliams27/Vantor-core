// src/lib/policy/templates.ts
//
// Template-first authoring. CFOs/treasury managers pick from this
// registry when creating new rules — covers the common safety
// patterns without exposing the full IR. Custom rule authoring
// (PR 2) fills the expressiveness gap for power users.
//
// Each template:
//   - Declares which `value-field` inputs it needs (amount, role, days…)
//   - Compiles those values into a PolicyRule via `build()` so the
//     route's rule-creation API receives a canonical IR.
//   - Provides a natural-language sentence used for live preview in
//     the editor and for the summary on rule rows.

import type { MovementKind } from './types/movement';
import type { PolicyRule } from './types/policy-version';

export type TemplateFieldKind = 'amount' | 'role_min' | 'days' | 'movement_kind' | 'text';

export interface TemplateField {
  key: string;
  kind: TemplateFieldKind;
  label: string;
  helper?: string;
  /** Default value to preload into the form. */
  defaultValue: string | number;
  /** Only for movement_kind + role_min — constrained options. */
  options?: Array<{ value: string; label: string }>;
}

export interface RuleTemplateInput {
  name: string;
  values: Record<string, string | number>;
}

export interface RuleTemplate {
  id: string;
  /** Icon variant for the IconTile in the template picker. */
  iconVariant: 'active' | 'pending' | 'failed' | 'info' | 'special' | 'urgent';
  title: string;
  /** Short helper shown in the picker + used on the rule row when no custom name. */
  blurb: string;
  fields: TemplateField[];
  /** Returns natural-language summary given values — updates live as user types. */
  summary: (values: Record<string, string | number>) => string;
  /** Compiles a PolicyRule ready to POST to /api/policy/versions/[id]/rules. */
  build: (input: RuleTemplateInput) => Omit<PolicyRule, 'id' | 'version_id'>;
}

// ─── Shared field definitions ───────────────────────────────────────────

const AMOUNT_FIELD: TemplateField = {
  key: 'amount',
  kind: 'amount',
  label: 'Amount threshold (USD)',
  helper: 'Rule triggers at or above this USD-normalized amount.',
  defaultValue: 50_000,
};

const ROLE_MIN_FIELD: TemplateField = {
  key: 'role_min',
  kind: 'role_min',
  label: 'Minimum approver role',
  defaultValue: 'treasury_manager',
  options: [
    { value: 'accountant', label: 'Accountant' },
    { value: 'treasury_manager', label: 'Treasury manager' },
    { value: 'executive', label: 'Executive' },
    { value: 'enterprise_admin', label: 'Enterprise admin' },
  ],
};

const DAYS_NEW_COUNTERPARTY: TemplateField = {
  key: 'days',
  kind: 'days',
  label: 'Counterparty must be newer than (days)',
  helper: 'Counterparties first seen within this many days are treated as "new".',
  defaultValue: 30,
};

const MOVEMENT_KIND_FIELD: TemplateField = {
  key: 'movement_kind',
  kind: 'movement_kind',
  label: 'Movement kind',
  defaultValue: 'crypto_transfer',
  options: [
    { value: 'crypto_transfer', label: 'Crypto transfer' },
    { value: 'fiat_ramp',       label: 'Fiat ramp (on/off)' },
    { value: 'yield_deposit',   label: 'Yield deposit' },
    { value: 'yield_withdraw',  label: 'Yield withdraw' },
    { value: 'swap',            label: 'Swap' },
    { value: 'bridge',          label: 'Bridge' },
    { value: 'payment',         label: 'Bank payment' },
  ],
};

// ─── Templates ─────────────────────────────────────────────────────────

function toAmountString(v: string | number): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$]/g, ''));
  if (!isFinite(n)) return '0';
  return n.toString();
}

function formatAmount(v: string | number): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$]/g, ''));
  if (!isFinite(n)) return '$0';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'large_amount_approval',
    iconVariant: 'pending',
    title: 'Require approval for large transfers',
    blurb: 'Any movement above a USD threshold routes to human approval.',
    fields: [AMOUNT_FIELD, ROLE_MIN_FIELD],
    summary: (v) =>
      `Any transfer at or above ${formatAmount(v.amount)} USD requires ${String(v.role_min).replace('_', ' ')} approval.`,
    build: ({ name, values }) => ({
      rule_type: 'approval_threshold',
      name,
      rationale: 'Template: large-amount approval.',
      priority: 100,
      enabled: true,
      verdict: 'require_approval',
      condition: {
        kind: 'amount_compare',
        op: 'gte',
        value: { currency: 'USD', amount: toAmountString(values.amount) },
      },
    } as unknown as Omit<PolicyRule, 'id' | 'version_id'>),
  },

  {
    id: 'hard_limit_block',
    iconVariant: 'failed',
    title: 'Hard-block transfers over a cap',
    blurb: 'Anything above this USD ceiling is blocked outright — no override.',
    fields: [AMOUNT_FIELD],
    summary: (v) =>
      `Block any transfer at or above ${formatAmount(v.amount)} USD.`,
    build: ({ name, values }) => ({
      rule_type: 'approval_threshold',
      name,
      rationale: 'Template: hard-block over ceiling.',
      priority: 50,
      enabled: true,
      verdict: 'block',
      condition: {
        kind: 'amount_compare',
        op: 'gte',
        value: { currency: 'USD', amount: toAmountString(values.amount) },
      },
    } as unknown as Omit<PolicyRule, 'id' | 'version_id'>),
  },

  {
    id: 'new_counterparty_approval',
    iconVariant: 'urgent',
    title: 'Require approval for new counterparties',
    blurb: 'Transfers to counterparties first seen recently need a human look.',
    fields: [DAYS_NEW_COUNTERPARTY, ROLE_MIN_FIELD],
    summary: (v) =>
      `Transfers to counterparties first seen in the last ${v.days} days require ${String(v.role_min).replace('_', ' ')} approval.`,
    build: ({ name, values }) => ({
      rule_type: 'counterparty',
      name,
      rationale: 'Template: new counterparty approval gate.',
      priority: 90,
      enabled: true,
      verdict: 'require_approval',
      condition: {
        kind: 'time_compare',
        op: 'lt',
        field: 'counterparty.first_seen_age_days',
        value: Number(values.days),
      },
    } as unknown as Omit<PolicyRule, 'id' | 'version_id'>),
  },

  {
    id: 'sanctions_block',
    iconVariant: 'failed',
    title: 'Block sanctioned counterparties',
    blurb: 'Any match against the sanctions list is blocked before canonicalization.',
    fields: [],
    summary: () =>
      `Block any movement to or from a sanctioned counterparty.`,
    build: ({ name }) => ({
      rule_type: 'counterparty',
      name,
      rationale: 'Template: sanctions block. Defense-in-depth with route-level screening.',
      priority: 10,
      enabled: true,
      verdict: 'block',
      condition: {
        kind: 'sanctions_status',
        op: 'eq',
        value: 'sanctioned',
      },
    } as unknown as Omit<PolicyRule, 'id' | 'version_id'>),
  },

  {
    id: 'daily_outflow_cap',
    iconVariant: 'pending',
    title: 'Daily outflow cap per initiator',
    blurb: 'Require approval once a user exceeds their daily outflow budget.',
    fields: [AMOUNT_FIELD, ROLE_MIN_FIELD],
    summary: (v) =>
      `Require ${String(v.role_min).replace('_', ' ')} approval once the initiator's 24h outflow exceeds ${formatAmount(v.amount)} USD.`,
    build: ({ name, values }) => ({
      rule_type: 'time_window',
      name,
      rationale: 'Template: trailing 24h outflow cap per initiator.',
      priority: 80,
      enabled: true,
      verdict: 'require_approval',
      condition: {
        kind: 'aggregate_window',
        window_spec: {
          duration_ms: 86_400_000,
          group_by: { initiator: true },
          direction: 'outflow',
        },
        metric: 'sum_amount_usd',
        op: 'gte',
        value: { currency: 'USD', amount: toAmountString(values.amount) },
      },
    } as unknown as Omit<PolicyRule, 'id' | 'version_id'>),
  },

  {
    id: 'kind_specific_approval',
    iconVariant: 'special',
    title: 'Gate a specific movement kind',
    blurb: 'Require approval on one rail (e.g. only yield withdrawals).',
    fields: [MOVEMENT_KIND_FIELD, ROLE_MIN_FIELD],
    summary: (v) => {
      const kindLabel = MOVEMENT_KIND_FIELD.options!.find((o) => o.value === v.movement_kind)?.label
        ?? String(v.movement_kind);
      return `Any ${kindLabel.toLowerCase()} requires ${String(v.role_min).replace('_', ' ')} approval.`;
    },
    build: ({ name, values }) => ({
      rule_type: 'approval_threshold',
      name,
      rationale: 'Template: kind-specific approval gate.',
      priority: 110,
      enabled: true,
      verdict: 'require_approval',
      condition: {
        kind: 'string_compare',
        op: 'eq',
        field: 'kind',
        value: String(values.movement_kind) as MovementKind,
      },
    } as unknown as Omit<PolicyRule, 'id' | 'version_id'>),
  },

  {
    id: 'forecast_coverage_block',
    iconVariant: 'failed',
    title: 'Block if obligations wouldn\'t be covered',
    blurb: 'Treasury-aware safety: don\'t allow an outflow that would leave upcoming obligations uncovered.',
    fields: [
      {
        key: 'days',
        kind: 'days',
        label: 'Forecast horizon (days)',
        helper: 'How far ahead to look when checking obligation coverage.',
        defaultValue: 14,
      },
    ],
    summary: (v) =>
      `Block any outflow that would leave obligations in the next ${v.days} days uncovered.`,
    build: ({ name, values }) => ({
      rule_type: 'lookahead',
      name,
      rationale: 'Template: obligation-coverage forecast gate.',
      priority: 40,
      enabled: true,
      verdict: 'block',
      condition: {
        kind: 'forecast_query',
        method: 'obligations_covered',
        window_days: Number(values.days),
        op: 'eq',
        value: false,
      },
    } as unknown as Omit<PolicyRule, 'id' | 'version_id'>),
  },

  {
    id: 'ai_initiated_approval',
    iconVariant: 'info',
    title: 'Require human approval on AI recommendations',
    blurb: 'Any movement initiated by an AI recommendation routes to approval, regardless of amount.',
    fields: [ROLE_MIN_FIELD],
    summary: (v) =>
      `All AI-initiated movements require ${String(v.role_min).replace('_', ' ')} approval.`,
    build: ({ name, values }) => ({
      rule_type: 'approval_threshold',
      name,
      rationale: 'Template: AI-initiator approval floor. Redundant with system invariant; explicit for audit.',
      priority: 5,
      enabled: true,
      verdict: 'require_approval',
      condition: {
        kind: 'string_compare',
        op: 'eq',
        field: 'initiator.type',
        value: 'ai_recommendation',
      },
    } as unknown as Omit<PolicyRule, 'id' | 'version_id'>),
  },
];

export function getTemplate(id: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.id === id);
}
