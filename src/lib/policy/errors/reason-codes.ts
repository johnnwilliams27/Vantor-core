/**
 * Closed enumeration of every policy engine reason code. Codes are API surface
 * and must not be renamed after shipping. See
 * docs/superpowers/specs/2026-04-10-treasury-policy-engine-design.md §11.
 */
export const REASON_CODES = {
  // ─── Canonicalization ────────────────────────────────────────────────
  canonicalization_failed:           'canonicalization_failed',
  canonicalization_source_unavailable: 'canonicalization_source_unavailable',
  canonicalization_rate_stale:       'canonicalization_rate_stale',

  // ─── Evaluation engine ───────────────────────────────────────────────
  condition_node_evaluation_failed:  'condition_node_evaluation_failed',
  forecast_unavailable:              'forecast_unavailable',
  aggregate_query_failed:            'aggregate_query_failed',
  sanctions_status_unavailable:      'sanctions_status_unavailable',
  counterparty_lookup_failed:        'counterparty_lookup_failed',
  policy_version_not_active:         'policy_version_not_active',

  // ─── Hard limit checker ──────────────────────────────────────────────
  hard_limit_breached:               'hard_limit_breached',
  treasury_state_unavailable:        'treasury_state_unavailable',
  scope_resolution_failed:           'scope_resolution_failed',
  historical_outflow_unavailable:    'historical_outflow_unavailable',

  // ─── Splitting detector ──────────────────────────────────────────────
  window_spec_invalid:               'window_spec_invalid',

  // ─── Approval workflow ───────────────────────────────────────────────
  approval_not_pending:              'approval_not_pending',
  sod_initiator_conflict:            'sod_initiator_conflict',
  sod_rule_editor_conflict:          'sod_rule_editor_conflict',
  sod_already_filled:                'sod_already_filled',
  enterprise_admin_cannot_approve:   'enterprise_admin_cannot_approve',
  no_matching_slot:                  'no_matching_slot',
  approval_concurrent_modification:  'approval_concurrent_modification',
  stale_approval_chain_mismatch:     'stale_approval_chain_mismatch',
  stale_approval_reevaluation_failed: 'stale_approval_reevaluation_failed',
  activation_reason_too_short:       'activation_reason_too_short',
  chain_unsatisfiable_at_activation: 'chain_unsatisfiable_at_activation',

  // ─── Simulation ──────────────────────────────────────────────────────
  historical_context_incomplete:     'historical_context_incomplete',
  new_forecast_query_fresh_data:     'new_forecast_query_fresh_data',
  new_aggregate_window_approximated: 'new_aggregate_window_approximated',
  obligation_coverage_stub_at_time:  'obligation_coverage_stub_at_time',
  simulation_already_running:        'simulation_already_running',
  draft_deleted:                     'draft_deleted',
  simulation_window_too_large:       'simulation_window_too_large',

  // ─── Rule authoring ──────────────────────────────────────────────────
  condition_ir_type_mismatch:        'condition_ir_type_mismatch',
  condition_ir_schema_invalid:       'condition_ir_schema_invalid',
  usd_rule_on_rateless_asset:        'usd_rule_on_rateless_asset',
  native_unit_currency_mismatch:     'native_unit_currency_mismatch',
  chain_reference_not_found:         'chain_reference_not_found',
  rule_priority_collision:           'rule_priority_collision',
  activation_blocked_by_validation:  'activation_blocked_by_validation',
  activation_race_conflict:          'activation_race_conflict',
  requires_policy_admin:             'requires_policy_admin',
  version_not_draft:                 'version_not_draft',
  hard_limit_value_out_of_range:     'hard_limit_value_out_of_range',
  obligation_coverage_advisory_only: 'obligation_coverage_advisory_only',

  // ─── Gate / execution ────────────────────────────────────────────────
  movement_validation_failed:        'movement_validation_failed',
  movement_kind_unsupported:         'movement_kind_unsupported',
  idempotency_key_conflict:          'idempotency_key_conflict',
  adapter_execution_failed:          'adapter_execution_failed',
  gate_internal_error:               'gate_internal_error',
} as const;

export type ReasonCode = typeof REASON_CODES[keyof typeof REASON_CODES];

/**
 * Warnings (not errors — attached to traces, never cause a block on their own).
 */
export const WARNING_CODES = {
  forecast_stub_mode:            'forecast_stub_mode',
  ai_initiator_floor_applied:    'ai_initiator_floor_applied',
  splitting_matched:             'splitting_matched',
  default_deny_triggered:        'default_deny_triggered',
} as const;

export type WarningCode = typeof WARNING_CODES[keyof typeof WARNING_CODES];
