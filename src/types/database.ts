export type UserRole = 'treasury_manager' | 'accountant' | 'auditor';
export type ChainType = 'ethereum' | 'solana';
export type TokenSymbol = 'USDC' | 'USDT' | 'PYUSD';
export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type InvoiceStatus = 'unpaid' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled';
export type ErpProvider = 'sap' | 'oracle' | 'xero' | 'netsuite';
export type AuditAction =
  | 'login' | 'logout'
  | 'payment_create' | 'payment_execute' | 'payment_cancel' | 'payment_schedule'
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
  | 'bank_balance_refresh';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  onboarding_done: boolean;
  created_at: string;
  updated_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
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
  invoice_number: string;
  description: string | null;
  amount: string;
  token: TokenSymbol;
  chain: ChainType;
  status: InvoiceStatus;
  due_date: string | null;
  paid_at: string | null;
  linked_tx_id: string | null;
  created_at: string;
  updated_at: string;
  // joined
  vendor?: ErpVendor;
  linked_tx?: Transaction;
}

export interface Payment {
  id: string;
  user_id: string;
  erp_config_id: string | null;
  invoice_id: string | null;
  from_wallet_id: string;
  to_address: string;
  chain: ChainType;
  token: TokenSymbol;
  amount: string;
  status: PaymentStatus;
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

export interface PaymentAttempt {
  id: string;
  payment_id: string;
  attempt_no: number;
  status: PaymentStatus;
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
  status: PaymentStatus;
  quote_data: Record<string, unknown> | null;
  executed_at: string | null;
  created_at: string;
}

export interface GlPosting {
  id: string;
  user_id: string;
  erp_config_id: string;
  invoice_id: string | null;
  payment_id: string | null;
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
  bank_account?: Pick<BankAccount, 'institution_name' | 'account_name' | 'last4'>;
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
