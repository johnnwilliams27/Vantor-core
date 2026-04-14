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
//     route's rule-creation API receives a canonical IR that matches
//     schemas/ir.schema.ts. Templates that produced shapes the schema
//     rejected were the root cause of the 2026-04-13 template-picker
//     400s — keep the shapes here aligned with schemas/ir.schema.ts.

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
  helper: 'A single-slot approval chain at this role is created alongside the rule. Enterprise admins cannot approve under their own policy (SoD).',
  defaultValue: 'treasury_manager',
  options: [
    { value: 'accountant', label: 'Accountant' },
    { value: 'treasury_manager', label: 'Treasury manager' },
    { value: 'executive', label: 'Executive' },
  ],
};

// ─── Helpers ───────────────────────────────────────────────────────────

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

// ─── Templates ─────────────────────────────────────────────────────────
//
// NOTE on omitted templates:
//   - "Require approval for new counterparties" needs a first_seen_age
//     time attribute that the IR doesn't expose yet.
//   - "Gate a specific movement kind" needs a movement.kind string
//     attribute.
//   - "Block if obligations wouldn't be covered" needs boolean forecast
//     values; the current forecast_query shape is numeric.
// Re-add these after the IR is extended.

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
      verdict: 'require_approval',
      condition: {
        kind: 'amount_compare',
        attr: 'transfer.amount',
        op: '>=',
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
      verdict: 'block',
      condition: {
        kind: 'amount_compare',
        attr: 'transfer.amount',
        op: '>=',
        value: { currency: 'USD', amount: toAmountString(values.amount) },
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
      verdict: 'block',
      condition: {
        kind: 'sanctions_status',
        op: 'in',
        values: ['sanctioned'],
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
      verdict: 'require_approval',
      condition: {
        kind: 'aggregate_window',
        window: {
          duration_ms: 86_400_000,
          group_by: { initiator: true },
          direction: 'outflow',
        },
        attr: 'sum_amount',
        op: '>=',
        value: { currency: 'USD', amount: toAmountString(values.amount) },
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
    build: ({ name }) => ({
      rule_type: 'approval_threshold',
      name,
      rationale: 'Template: AI-initiator approval floor. Redundant with system invariant; explicit for audit.',
      priority: 5,
      verdict: 'require_approval',
      condition: {
        kind: 'string_compare',
        attr: 'transfer.initiator_type',
        op: '==',
        value: 'ai_recommendation',
      },
    } as unknown as Omit<PolicyRule, 'id' | 'version_id'>),
  },
];

export function getTemplate(id: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.id === id);
}
