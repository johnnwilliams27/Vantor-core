export type UserRole = 'enterprise_admin' | 'treasury_manager' | 'accountant' | 'auditor';
export type EnterpriseStatus = 'active' | 'frozen' | 'suspended' | 'pending_kyc';
export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected';

export interface Enterprise {
  id: string;
  name: string;
  status: EnterpriseStatus;
  kyc_status: KycStatus;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
  country: string | null;  // ISO 3166-1 alpha-2
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
export type ChainType = 'ethereum' | 'solana';
export type TokenSymbol = 'USDC' | 'USDT';
export type TransferStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type InvoiceStatus = 'unpaid' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled';
export type ErpProvider = 'sap' | 'oracle' | 'xero' | 'netsuite';
export type AuditAction =
  | 'login' | 'logout'
  | 'transfer_create' | 'transfer_execute' | 'transfer_cancel' | 'transfer_schedule'
  | 'invoice_create' | 'invoice_update' | 'invoice_sync' | 'invoice_link_tx'
  | 'swap_quote' | 'swap_execute'
  | 'wallet_connect' | 'wallet_disconnect'
  | 'erp_connect' | 'erp_sync'
  | 'gl_post'
  | 'settings_update'
  | 'bank_account_connect' | 'bank_account_disconnect'
  | 'onramp_execute' | 'offramp_execute'
  | 'treasury_rule_create' | 'treasury_rule_update'
  | 'treasury_obligation_create' | 'treasury_obligation_delete'
  | 'treasury_recommendation_generate' | 'treasury_recommendation_approve'
  | 'treasury_recommendation_reject' | 'treasury_recommendation_execute'
  | 'bank_balance_refresh'
  | 'treasury_forecast_generate' | 'treasury_simulation_run'
  | 'treasury_report_export' | 'treasury_price_refresh'
  | 'slack_connect' | 'slack_disconnect' | 'slack_test'
  | 'slack_recommendation_notify' | 'slack_recommendation_approve' | 'slack_recommendation_reject'
  | 'compliance_sanctions_screen' | 'compliance_kyt_register' | 'compliance_kyt_alert'
  | 'compliance_travel_rule_create' | 'compliance_travel_rule_update' | 'compliance_override'
  | 'yield_deposit' | 'yield_withdraw' | 'yield_position_refresh'
  | 'scheduled_operation_create' | 'scheduled_operation_approve'
  | 'scheduled_operation_cancel' | 'scheduled_operation_expire'
  | 'scheduled_operation_execute' | 'scheduled_operation_deviation'
  | 'bridge_execute'
  | 'fiat_payment_create' | 'fiat_payment_execute'
  | 'fiat_payment_cancel' | 'fiat_payment_settle'
  | 'counterparty_create' | 'counterparty_screen'
  | 'screening_case_open' | 'screening_case_clear' | 'screening_case_escalate'
  | 'screening_case_block' | 'screening_case_reassign' | 'screening_case_note'
  | 'screening_adhoc_lookup'
  | 'insight_create' | 'insight_view' | 'insight_dismiss' | 'insight_acted_on' | 'insight_expire'
  | 'transfer_create_blocked' | 'transfer_create_requires_approval';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  onboarding_done: boolean;
  enterprise_id: string | null;
  is_app_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  chain: ChainType;
  address: string;
  label: string | null;
  is_primary: boolean;
  verified_at: string | null;
  created_at: string;
}

export interface WalletBalance {
  id: string;
  wallet_id: string;
  token: TokenSymbol;
  balance: string;
  usd_value: string | null;
  last_updated: string;
}

export interface BalanceSnapshot {
  id: string;
  wallet_id: string;
  token: TokenSymbol;
  balance: string;
  usd_value: string | null;
  snapped_at: string;
}

export interface ErpConfiguration {
  id: string;
  user_id: string;
  provider: ErpProvider;
  label: string;
  credentials: string;  // encrypted
  is_active: boolean;
  last_synced: string | null;
  created_at: string;
  updated_at: string;
}

export interface ErpVendor {
  id: string;
  erp_config_id: string;
  external_id: string;
  name: string;
  email: string | null;
  wallet_address: string | null;
  chain: ChainType | null;
  synced_at: string;
}

export interface Invoice {
  id: string;
  user_id: string;
  erp_config_id: string | null;
  erp_invoice_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  invoice_number: string;
  description: string | null;
  amount: string;
  currency: string;
  token: TokenSymbol | null;
  chain: ChainType | null;
  source: string;
  destination_address: string | null;
  status: InvoiceStatus;
  due_date: string | null;
  paid_at: string | null;
  linked_tx_id: string | null;
  created_at: string;
  updated_at: string;
  // joined
  vendor?: ErpVendor;
  linked_tx?: Transaction;
  erp_config?: Pick<ErpConfiguration, 'id' | 'label' | 'provider'>;
}

export interface Transfer {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  erp_config_id: string | null;
  invoice_id: string | null;
  direction: 'sent' | 'received';
  from_wallet_id: string | null;
  from_address: string | null;
  to_address: string;
  chain: ChainType;
  token: TokenSymbol;
  amount: string;
  status: TransferStatus;
  scheduled_for: string | null;
  executed_at: string | null;
  tx_hash: string | null;
  error_message: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
  // joined
  from_wallet?: Wallet;
  invoice?: Invoice;
  erp_config?: Pick<ErpConfiguration, 'id' | 'label' | 'provider'>;
}

export interface TransferAttempt {
  id: string;
  transfer_id: string;
  attempt_no: number;
  status: TransferStatus;
  tx_hash: string | null;
  error: string | null;
  attempted_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  wallet_id: string | null;
  chain: ChainType;
  tx_hash: string;
  block_number: number | null;
  from_address: string;
  to_address: string;
  token: TokenSymbol | null;
  amount: string | null;
  fee: string | null;
  status: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  raw_data: Record<string, unknown> | null;
  created_at: string;
}

export interface Swap {
  id: string;
  user_id: string;
  wallet_id: string;
  chain: ChainType;
  from_token: TokenSymbol;
  to_token: TokenSymbol;
  from_amount: string;
  to_amount: string | null;
  rate: string | null;
  slippage_bps: number | null;
  tx_hash: string | null;
  status: TransferStatus;
  quote_data: Record<string, unknown> | null;
  executed_at: string | null;
  created_at: string;
  // joined
  wallet?: Pick<Wallet, 'id' | 'label' | 'address' | 'chain'>;
}

export type BridgeProvider = 'cctp' | 'layerzero';

export interface BridgeTransfer {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  from_wallet_id: string | null;
  to_wallet_id: string | null;
  token: TokenSymbol;
  amount: string;
  received_amount: string | null;
  bridge_fee: string;
  from_chain: ChainType;
  to_chain: ChainType;
  provider: BridgeProvider;
  tx_hash: string | null;
  status: TransferStatus;
  slippage_bps: number | null;
  estimated_arrival_minutes: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  from_wallet?: Pick<Wallet, 'id' | 'label' | 'address' | 'chain'>;
  to_wallet?: Pick<Wallet, 'id' | 'label' | 'address' | 'chain'>;
}

export interface GlPosting {
  id: string;
  user_id: string;
  erp_config_id: string;
  invoice_id: string | null;
  transfer_id: string | null;
  external_gl_id: string | null;
  amount: string;
  token: TokenSymbol;
  gl_account: string;
  posted_at: string;
  status: string;
  response_data: Record<string, unknown> | null;
}

export interface BankAccount {
  id: string;
  user_id: string;
  plaid_item_id: string | null;
  plaid_account_id: string | null;
  institution_name: string;
  account_name: string;
  account_type: string;
  last4: string | null;
  routing_number: string | null;
  currency: string;
  is_active: boolean;
  verified_at: string | null;
  created_at: string;
  current_balance: string | null;
  balance_currency: string;
  balance_as_of: string | null;
  nickname: string | null;
  banking_provider: 'stripe_fc' | 'belvo' | 'manual';
  stripe_fc_account_id: string | null;
  iban: string | null;
  belvo_link_id: string | null;
  belvo_account_id: string | null;
}

export interface FiatTransaction {
  id: string;
  user_id: string;
  bank_account_id: string | null;
  direction: 'onramp' | 'offramp';
  crypto_amount: string;
  crypto_token: string;
  fiat_amount: string;
  fiat_currency: string;
  exchange_rate: string | null;
  fee_amount: string | null;
  status: string;
  provider: string;
  provider_transaction_id: string | null;
  settled_at: string | null;
  created_at: string;
  // joined
  bank_account?: Pick<BankAccount, 'institution_name' | 'account_name' | 'last4' | 'nickname'>;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: AuditAction;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  // joined
  user_profile?: UserProfile;
}

// ---- Treasury AI ----

export type RecommendationStatus =
  | 'pending_approval' | 'approved' | 'rejected'
  | 'executed' | 'expired' | 'auto_executed';
export type RecommendationAction = 'onramp' | 'offramp' | 'no_action';

export interface TreasuryRule {
  id: string;
  user_id: string;
  label: string;
  is_active: boolean;
  safety_buffer_multiplier: string;
  obligation_lookahead_days: number;
  target_stablecoin: string;
  target_chain: string;
  approval_threshold_usd: string;
  created_at: string;
  updated_at: string;
}

/** @deprecated Use `Obligation` from `@/lib/obligations/types` — extended in migration 0041 */
export interface ManualObligation {
  id: string;
  user_id: string;
  label: string;
  description: string | null;
  amount_usd: string;
  due_date: string;
  is_recurring: boolean;
  recurrence_days: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiRecommendation {
  id: string;
  user_id: string;
  treasury_rule_id: string | null;
  total_bank_balance_usd: string;
  total_crypto_balance_usd: string;
  obligations_in_window_usd: string;
  safety_buffer_target_usd: string;
  obligation_lookahead_days: number;
  action: RecommendationAction;
  recommended_amount_usd: string | null;
  bank_account_id: string | null;
  stablecoin_token: string | null;
  stablecoin_chain: string | null;
  ai_reasoning: string;
  ai_model: string;
  status: RecommendationStatus;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  executed_at: string | null;
  fiat_transaction_id: string | null;
  execution_error: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  // joined
  bank_account?: Pick<BankAccount, 'id' | 'institution_name' | 'account_name' | 'last4'>;
}

// ---- Treasury AI Phase 2 ----

// ---- Chainalysis Compliance ----

export type ScreeningResult = 'clear' | 'sanctioned' | 'partial_match' | 'error';
export type KytAlertSeverity = 'low' | 'medium' | 'high' | 'severe';
export type KytAlertStatus = 'open' | 'under_review' | 'dismissed' | 'escalated' | 'resolved';
export type TravelRuleStatus = 'pending' | 'sent' | 'received' | 'accepted' | 'rejected' | 'failed';

export interface SanctionsScreening {
  id: string;
  user_id: string;
  address: string;
  chain: ChainType;
  result: ScreeningResult;
  risk_score: string | null;
  match_details: Record<string, unknown> | null;
  provider: string;
  entity_type: string | null;
  entity_id: string | null;
  screened_at: string;
  expires_at: string;
  created_at: string;
}

export interface KytTransfer {
  id: string;
  user_id: string;
  external_id: string;
  chain: ChainType;
  direction: 'sent' | 'received';
  tx_hash: string | null;
  from_address: string;
  to_address: string;
  token: TokenSymbol | null;
  amount: string | null;
  asset_amount_usd: string | null;
  risk_score: string | null;
  cluster_name: string | null;
  cluster_category: string | null;
  raw_response: Record<string, unknown> | null;
  transfer_id: string | null;
  transaction_id: string | null;
  registered_at: string;
  created_at: string;
}

export interface KytAlert {
  id: string;
  user_id: string;
  kyt_transfer_id: string | null;
  external_alert_id: string | null;
  severity: KytAlertSeverity;
  status: KytAlertStatus;
  category: string | null;
  description: string | null;
  raw_data: Record<string, unknown> | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  // joined
  kyt_transfer?: KytTransfer;
}

export interface TravelRuleTransfer {
  id: string;
  user_id: string;
  transfer_id: string | null;
  direction: 'outgoing' | 'incoming';
  amount_usd: string;
  originator_name: string | null;
  originator_address: string | null;
  originator_wallet: string;
  originator_chain: ChainType;
  originator_vasp: string | null;
  beneficiary_name: string | null;
  beneficiary_address: string | null;
  beneficiary_wallet: string;
  beneficiary_chain: ChainType;
  beneficiary_vasp: string | null;
  status: TravelRuleStatus;
  provider_ref: string | null;
  raw_response: Record<string, unknown> | null;
  error_message: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Treasury AI Phase 2 ----

export interface StablecoinPrices {
  USDC: number;
  USDT: number;
}

export interface ForecastDataPoint {
  date: string;
  projectedBalanceUsd: number;
  obligationsDueUsd: number;
  safetyBufferUsd: number;
  isBelow: boolean;
  scheduledRampsUsd: number;
  obligationLabels: string[];
}

export interface TreasuryForecast {
  id: string;
  user_id: string;
  lookahead_days: number;
  forecast_data: ForecastDataPoint[];
  ai_summary: string | null;
  generated_at: string;
  created_at: string;
}

export interface SimulationRecordResult {
  recommendation_id: string;
  created_at: string;
  action: RecommendationAction;
  recommended_amount_usd: number;
  status: RecommendationStatus;
  actual_bank_balance_usd: number;
  actual_obligations_usd: number;
  actual_safety_buffer_usd: number;
  simulated_action: RecommendationAction;
  simulated_amount_usd: number | null;
  simulated_safety_buffer_usd: number;
  delta_usd: number | null;
  was_executed: boolean;
  counterfactual_note: string;
}

export interface SimulationSummary {
  total_recommendations: number;
  executed_count: number;
  simulated_executed_count: number;
  avg_delta_usd: number | null;
  total_missed_opportunity_usd: number;
  coverage_improvement_pct: number | null;
}

export interface SimulationRun {
  id: string;
  user_id: string;
  rule_snapshot: {
    safety_buffer_multiplier: number;
    obligation_lookahead_days: number;
    approval_threshold_usd: number;
    label: string;
  };
  results: SimulationRecordResult[];
  summary: SimulationSummary;
  created_at: string;
}

// ---- Yield Protocols ----

export type YieldProtocolId = 'aave_v3' | 'morpho_reservoir' | 'kamino' | 'ondo_usdy';
export type YieldTxType = 'deposit' | 'withdraw';
export type YieldTxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface YieldPosition {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  wallet_id: string | null;
  protocol: YieldProtocolId;
  chain: ChainType;
  underlying_token: TokenSymbol;
  yield_token: string;
  deposited_amount: string;
  yield_token_balance: string;
  current_value_usd: string;
  accrued_yield_usd: string;
  apy_snapshot: string | null;
  last_refreshed_at: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface YieldTransaction {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  position_id: string | null;
  protocol: YieldProtocolId;
  chain: ChainType;
  tx_type: YieldTxType;
  underlying_token: TokenSymbol;
  amount: string;
  amount_usd: string | null;
  tx_hash: string | null;
  status: YieldTxStatus;
  error_message: string | null;
  executed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---- EU Banking / Yield Tier ----

export interface OndoKycVerification {
  id: string;
  enterprise_id: string;
  wallet_address: string;
  status: 'pending' | 'verified';
  verified_at: string | null;
  created_at: string;
}

export interface YieldRateCache {
  id: string;
  protocol: string;
  token: string;
  chain: string;
  supply_apy: number;
  reward_apy: number;
  total_apy: number;
  fetched_at: string;
  is_stale: boolean;
}
