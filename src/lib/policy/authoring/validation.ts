import { REASON_CODES } from '../errors/reason-codes';
import { AuthoringError } from './errors';
import { conditionSchema } from '../schemas/ir.schema';
import { hardLimitTypeSchema } from '../schemas/primitives';
import {
  UpsertRuleRequest,
  UpsertHardLimitRequest,
  UpsertApprovalChainRequest,
} from './types';
import { PolicyVersionSnapshot } from '../types/policy-version';
import { AssetCode } from '../types/assets';
import { APPROVER_ROLES } from '@/lib/auth/roles';

const RATE_SUPPORTED_ASSETS: ReadonlySet<AssetCode> = new Set<AssetCode>(['USD', 'USDC', 'USDT']);

/**
 * Roles accepted in approval chain slots. Sourced from the single
 * source of truth so this stays in lockstep with the TS union and
 * rank map. The legacy 'approver' literal was dropped here during
 * the RBAC hierarchy consolidation.
 */
const VALID_SLOT_ROLES: ReadonlySet<string> = new Set(APPROVER_ROLES);

export interface ValidateRuleOptions {
  /** @default true */
  requireChainForApproval?: boolean;
}

export function validateRuleInput(
  input: UpsertRuleRequest,
  opts: ValidateRuleOptions = { requireChainForApproval: true },
): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.condition_ir_schema_invalid,
      human_readable: 'Rule name cannot be empty.',
      user_action: 'Provide a human-readable name for the rule.',
      details: {},
      path: ['name'],
    });
  }

  if (!Number.isInteger(input.priority) || input.priority < 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.condition_ir_schema_invalid,
      human_readable: 'Rule priority must be a non-negative integer.',
      user_action: 'Enter a whole number for priority.',
      details: { priority: input.priority },
      path: ['priority'],
    });
  }

  const parsed = conditionSchema.safeParse(input.condition);
  if (!parsed.success) {
    throw new AuthoringError({
      reason_code: REASON_CODES.condition_ir_schema_invalid,
      human_readable: `Rule condition is not a valid IR node: ${parsed.error.message}`,
      user_action: 'Fix the condition shape in the rule editor.',
      details: { zod_error: parsed.error.flatten() },
      path: ['condition'],
    });
  }

  if (
    opts.requireChainForApproval &&
    input.verdict === 'require_approval' &&
    !input.verdict_chain_id
  ) {
    throw new AuthoringError({
      reason_code: REASON_CODES.chain_reference_not_found,
      human_readable:
        'Rules with verdict=require_approval must reference an approval chain.',
      user_action: 'Select an approval chain for this rule.',
      details: { rule_name: input.name },
      path: ['verdict_chain_id'],
    });
  }

  // Step 4: Currency consistency — when scope.asset is set, the rule's
  // value.currency must be either USD (canonical) or the same as the scoped
  // asset. Cross-stablecoin mismatches (e.g., USDC threshold on USDT position)
  // are rejected because the canonicalizer may not have a cross-rate.
  if (input.condition.kind === 'amount_compare' && input.condition.scope?.asset) {
    const scopedAsset = input.condition.scope.asset as AssetCode;
    const valueCurrency = input.condition.value.currency;

    if (!RATE_SUPPORTED_ASSETS.has(scopedAsset)) {
      // Asset has no rate source at all — reject any USD-denominated rule
      throw new AuthoringError({
        reason_code: REASON_CODES.usd_rule_on_rateless_asset,
        human_readable:
          `Cannot use USD comparison on ${scopedAsset} — the canonicalizer does not have a rate source for this asset. Use a native-unit comparison instead.`,
        user_action: `Change the rule value.currency to ${scopedAsset}, or remove scope.asset to target the overall transfer.`,
        details: { scoped_asset: scopedAsset },
        path: ['condition', 'value', 'currency'],
      });
    }

    if (valueCurrency !== 'USD' && valueCurrency !== scopedAsset) {
      // Cross-stablecoin mismatch (e.g., USDC threshold on USDT position)
      throw new AuthoringError({
        reason_code: REASON_CODES.native_unit_currency_mismatch,
        human_readable:
          `Rule value currency '${valueCurrency}' does not match scoped asset '${scopedAsset}'. Use '${scopedAsset}' for native-unit or 'USD' for canonical comparison.`,
        user_action: `Change value.currency to '${scopedAsset}' or 'USD'.`,
        details: { scoped_asset: scopedAsset, value_currency: valueCurrency },
        path: ['condition', 'value', 'currency'],
      });
    }
  }
}

export function validateHardLimitInput(input: UpsertHardLimitRequest): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.hard_limit_value_out_of_range,
      human_readable: 'Hard limit name cannot be empty.',
      user_action: 'Provide a name for the limit.',
      details: {},
      path: ['name'],
    });
  }

  // Runtime limit_type validation — the TypeScript type is closed but the API
  // boundary receives unknown JSON. Reject fabricated types before the switch.
  const ltParsed = hardLimitTypeSchema.safeParse(input.limit_type);
  if (!ltParsed.success) {
    throw new AuthoringError({
      reason_code: REASON_CODES.hard_limit_value_out_of_range,
      human_readable: `Unknown hard limit type '${input.limit_type}'.`,
      user_action: 'Use one of the supported limit types.',
      details: { limit_type: input.limit_type },
      path: ['limit_type'],
    });
  }

  if (!/^(\d+)(\.\d+)?$/.test(input.limit_value)) {
    throw new AuthoringError({
      reason_code: REASON_CODES.hard_limit_value_out_of_range,
      human_readable: `Hard limit value "${input.limit_value}" is not a non-negative decimal.`,
      user_action: 'Enter a non-negative numeric value.',
      details: { limit_value: input.limit_value },
      path: ['limit_value'],
    });
  }

  const numericValue = parseFloat(input.limit_value);

  // Reject Infinity from extremely large numeric strings
  if (!Number.isFinite(numericValue)) {
    throw new AuthoringError({
      reason_code: REASON_CODES.hard_limit_value_out_of_range,
      human_readable: `Hard limit value "${input.limit_value}" exceeds representable range.`,
      user_action: 'Enter a smaller numeric value.',
      details: { limit_value: input.limit_value },
      path: ['limit_value'],
    });
  }

  switch (input.limit_type) {
    case 'min_cash_reserve_usd':
      if (numericValue <= 0) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'min_cash_reserve_usd must be greater than 0.',
          user_action: 'Enter a positive value.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      if (input.limit_currency !== 'USD') {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'min_cash_reserve_usd requires limit_currency=USD.',
          user_action: 'Set limit_currency to USD.',
          details: { limit_currency: input.limit_currency },
          path: ['limit_currency'],
        });
      }
      break;

    case 'max_single_asset_concentration_pct':
      if (numericValue <= 0 || numericValue > 100) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'Concentration percentage must be between 0 and 100 (exclusive of 0).',
          user_action: 'Enter a value greater than 0 and at most 100.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      break;

    case 'max_daily_outflow_usd':
    case 'max_30day_outflow_usd':
      if (numericValue <= 0) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: `${input.limit_type} must be greater than 0.`,
          user_action: 'Enter a positive dollar amount.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      if (input.limit_currency !== 'USD') {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: `${input.limit_type} requires limit_currency=USD.`,
          user_action: 'Set limit_currency to USD.',
          details: { limit_currency: input.limit_currency },
          path: ['limit_currency'],
        });
      }
      break;

    case 'obligation_coverage_days':
      if (!Number.isInteger(numericValue) || numericValue <= 0) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'obligation_coverage_days must be a positive integer.',
          user_action: 'Enter a whole number of days.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      break;

    case 'max_native_exposure':
      if (numericValue <= 0) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'max_native_exposure must be greater than 0.',
          user_action: 'Enter a positive amount.',
          details: { limit_value: input.limit_value },
          path: ['limit_value'],
        });
      }
      if (!input.scope.asset) {
        throw new AuthoringError({
          reason_code: REASON_CODES.hard_limit_value_out_of_range,
          human_readable: 'max_native_exposure requires scope.asset to specify which asset the cap applies to.',
          user_action: 'Select an asset in the scope field.',
          details: {},
          path: ['scope', 'asset'],
        });
      }
      break;
  }
}

export function validateApprovalChainInput(input: UpsertApprovalChainRequest): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.chain_reference_not_found,
      human_readable: 'Chain name cannot be empty.',
      user_action: 'Provide a name for the chain.',
      details: {},
      path: ['name'],
    });
  }

  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    throw new AuthoringError({
      reason_code: REASON_CODES.chain_reference_not_found,
      human_readable: 'Chain must have at least one slot.',
      user_action: 'Add at least one approver slot to the chain.',
      details: {},
      path: ['slots'],
    });
  }

  // Validate individual slot fields
  for (const slot of input.slots) {
    if (!VALID_SLOT_ROLES.has(slot.minimum_role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.chain_reference_not_found,
        human_readable: `Invalid minimum_role '${slot.minimum_role}' on slot ${slot.slot_index}.`,
        user_action: 'Use one of: auditor, accountant, treasury_manager, approver, executive.',
        details: { slot_index: slot.slot_index, minimum_role: slot.minimum_role },
        path: ['slots', slot.slot_index, 'minimum_role'],
      });
    }
  }

  const indices = input.slots.map((s) => s.slot_index).sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) {
      throw new AuthoringError({
        reason_code: REASON_CODES.chain_reference_not_found,
        human_readable:
          `Chain slot_index values must be sequential starting from 0 (got ${indices.join(', ')}).`,
        user_action: 'Re-number the slots so they form a contiguous 0-based sequence.',
        details: { indices },
        path: ['slots'],
      });
    }
  }

  if (input.trigger_condition) {
    const parsed = conditionSchema.safeParse(input.trigger_condition);
    if (!parsed.success) {
      throw new AuthoringError({
        reason_code: REASON_CODES.condition_ir_schema_invalid,
        human_readable: `Chain trigger_condition is not a valid IR node: ${parsed.error.message}`,
        user_action: 'Fix the trigger condition shape.',
        details: {},
        path: ['trigger_condition'],
      });
    }
  }
}

export function validateVersionCoherent(version: PolicyVersionSnapshot): void {
  const priorities = new Map<number, string>();
  for (const rule of version.rules) {
    if (priorities.has(rule.priority)) {
      const existing = priorities.get(rule.priority);
      throw new AuthoringError({
        reason_code: REASON_CODES.rule_priority_collision,
        human_readable:
          `Rules '${existing}' and '${rule.name}' both have priority ${rule.priority}. Priorities must be unique within a version.`,
        user_action: 'Change the priority of one of the colliding rules.',
        details: { colliding_priority: rule.priority, rule_names: [existing, rule.name] },
        path: ['rules'],
      });
    }
    priorities.set(rule.priority, rule.name);
  }

  const chainIds = new Set(version.approval_chains.map((c) => c.id));
  for (const rule of version.rules) {
    if (rule.verdict === 'require_approval') {
      if (!rule.verdict_chain_id) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_reference_not_found,
          human_readable: `Rule '${rule.name}' has verdict=require_approval but no verdict_chain_id.`,
          user_action: 'Select an approval chain for this rule.',
          details: { rule_id: rule.id },
          path: ['rules'],
        });
      }
      if (!chainIds.has(rule.verdict_chain_id)) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_reference_not_found,
          human_readable:
            `Rule '${rule.name}' references chain '${rule.verdict_chain_id}' which does not exist in this version.`,
          user_action: 'Create the chain in this version or pick a different chain.',
          details: { rule_id: rule.id, chain_id: rule.verdict_chain_id },
          path: ['rules'],
        });
      }
    }
  }

  const seenLimits = new Map<string, string>();
  for (const limit of version.hard_limits) {
    const key = `${limit.limit_type}:${limit.scope.asset ?? ''}`;
    if (seenLimits.has(key)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.hard_limit_value_out_of_range,
        human_readable:
          `Two hard limits of type '${limit.limit_type}' have the same scope. Only one is allowed.`,
        user_action: 'Delete the duplicate or change its scope.',
        details: { limit_type: limit.limit_type, scope: limit.scope },
        path: ['hard_limits'],
      });
    }
    seenLimits.set(key, limit.id);
  }
}
