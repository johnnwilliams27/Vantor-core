import type { EventConfig, NotificationCategory } from '@/types/notifications';

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  treasury_ai: 'Treasury AI',
  transactions: 'Transactions',
  swaps: 'Swaps',
  ramps: 'Ramps',
  bridges: 'Bridges',
  payments: 'Payments',
  yield: 'Yield',
  compliance: 'Compliance',
  invoices: 'Invoices',
  scheduled_ops: 'Scheduled Operations',
  wallets_accounts: 'Wallets & Accounts',
  treasury_rules: 'Treasury Rules',
  team: 'Team',
  kyc_kyb: 'KYC / KYB',
  billing: 'Billing',
};

export const CATEGORY_ORDER: NotificationCategory[] = [
  'treasury_ai',
  'transactions',
  'swaps',
  'ramps',
  'bridges',
  'payments',
  'yield',
  'compliance',
  'invoices',
  'scheduled_ops',
  'wallets_accounts',
  'treasury_rules',
  'team',
  'kyc_kyb',
  'billing',
];

export const EVENT_CATALOG: EventConfig[] = [
  // Treasury AI
  { eventType: 'recommendation_pending', category: 'treasury_ai', label: 'Recommendation Pending Approval', description: 'New AI recommendation needs approval', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'recommendation_auto_executed', category: 'treasury_ai', label: 'Recommendation Auto-Executed', description: 'AI recommendation auto-executed below threshold', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'recommendation_approved', category: 'treasury_ai', label: 'Recommendation Approved', description: 'AI recommendation was approved and executed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'recommendation_rejected', category: 'treasury_ai', label: 'Recommendation Rejected', description: 'AI recommendation was rejected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'recommendation_expired', category: 'treasury_ai', label: 'Recommendation Expired', description: 'AI recommendation expired without action', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'recommendation_daily', category: 'treasury_ai', label: 'Daily AI Analysis', description: 'Daily automated treasury analysis with new recommendations', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'insight_critical', category: 'treasury_ai', label: 'Critical Treasury Insight', description: 'High-severity insight requiring immediate attention (liquidity shortfall, concentration breach)', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'insight_warning', category: 'treasury_ai', label: 'Treasury Insight Warning', description: 'Medium-severity insight — yield rebalance opportunity, concentration approaching cap, idle cash', defaultRoles: ['treasury_manager', 'accountant'] },

  // Transactions
  { eventType: 'transfer_completed', category: 'transactions', label: 'Transfer Completed', description: 'Crypto transfer was executed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'transfer_scheduled', category: 'transactions', label: 'Transfer Scheduled', description: 'Transfer was scheduled for future execution', defaultRoles: ['treasury_manager', 'accountant'] },

  // Swaps
  { eventType: 'swap_completed', category: 'swaps', label: 'Swap Completed', description: 'Token swap was executed', defaultRoles: ['treasury_manager', 'accountant'] },

  // Ramps
  { eventType: 'onramp_completed', category: 'ramps', label: 'On-Ramp Completed', description: 'Fiat to crypto conversion completed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'offramp_completed', category: 'ramps', label: 'Off-Ramp Completed', description: 'Crypto to fiat conversion completed', defaultRoles: ['treasury_manager', 'accountant'] },

  // Bridges
  { eventType: 'bridge_completed', category: 'bridges', label: 'Bridge Completed', description: 'Cross-chain bridge was executed', defaultRoles: ['treasury_manager', 'accountant'] },

  // Payments
  { eventType: 'payment_sent', category: 'payments', label: 'Payment Sent', description: 'Fiat payment was sent', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'payment_received', category: 'payments', label: 'Payment Received', description: 'Fiat payment was received', defaultRoles: ['treasury_manager', 'accountant'] },

  // Yield
  { eventType: 'yield_deposit_confirmed', category: 'yield', label: 'Yield Deposit Confirmed', description: 'Yield protocol deposit was confirmed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'yield_withdrawal_confirmed', category: 'yield', label: 'Yield Withdrawal Confirmed', description: 'Yield protocol withdrawal was confirmed', defaultRoles: ['treasury_manager', 'accountant'] },

  // Compliance
  { eventType: 'sanctions_alert', category: 'compliance', label: 'Sanctions Alert', description: 'Sanctions screening hit detected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'travel_rule_notification', category: 'compliance', label: 'Travel Rule Notification', description: 'Travel rule was triggered', defaultRoles: ['treasury_manager', 'accountant'] },

  // Invoices
  { eventType: 'invoice_synced', category: 'invoices', label: 'Invoice Synced', description: 'Invoice was synced from ERP', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'invoice_overdue', category: 'invoices', label: 'Invoice Overdue', description: 'Invoice is past due date', defaultRoles: ['treasury_manager', 'accountant'] },

  // Scheduled Ops
  { eventType: 'scheduled_swap_executed', category: 'scheduled_ops', label: 'Scheduled Swap Executed', description: 'Scheduled swap completed within tolerance', defaultRoles: ['treasury_manager'] },
  { eventType: 'scheduled_bridge_executed', category: 'scheduled_ops', label: 'Scheduled Bridge Executed', description: 'Scheduled bridge completed within tolerance', defaultRoles: ['treasury_manager'] },
  { eventType: 'scheduled_ramp_executed', category: 'scheduled_ops', label: 'Scheduled Ramp Executed', description: 'Scheduled ramp completed within tolerance', defaultRoles: ['treasury_manager'] },
  { eventType: 'scheduled_operation_flagged', category: 'scheduled_ops', label: 'Scheduled Op Flagged', description: 'Rate deviation exceeded tolerance, needs authorization', defaultRoles: ['treasury_manager'] },
  { eventType: 'scheduled_operation_failed', category: 'scheduled_ops', label: 'Scheduled Op Failed', description: 'Scheduled operation failed during execution', defaultRoles: ['treasury_manager'] },

  // Wallets & Accounts
  { eventType: 'wallet_connected', category: 'wallets_accounts', label: 'Wallet Connected', description: 'A wallet was connected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'wallet_disconnected', category: 'wallets_accounts', label: 'Wallet Disconnected', description: 'A wallet was disconnected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'bank_account_linked', category: 'wallets_accounts', label: 'Bank Account Linked', description: 'A bank account was linked', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'bank_account_removed', category: 'wallets_accounts', label: 'Bank Account Removed', description: 'A bank account was removed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'erp_connected', category: 'wallets_accounts', label: 'ERP Connected', description: 'An ERP system was connected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'erp_disconnected', category: 'wallets_accounts', label: 'ERP Disconnected', description: 'An ERP system was disconnected', defaultRoles: ['treasury_manager', 'accountant'] },

  // Treasury Rules
  { eventType: 'treasury_rule_created', category: 'treasury_rules', label: 'Treasury Rule Created', description: 'A new treasury rule was created', defaultRoles: ['treasury_manager'] },
  { eventType: 'treasury_rule_updated', category: 'treasury_rules', label: 'Treasury Rule Updated', description: 'A treasury rule was updated', defaultRoles: ['treasury_manager'] },

  // Team
  { eventType: 'member_invited', category: 'team', label: 'Member Invited', description: 'A new team member was invited', defaultRoles: ['treasury_manager'] },
  { eventType: 'member_removed', category: 'team', label: 'Member Removed', description: 'A team member was removed', defaultRoles: ['treasury_manager'] },
  { eventType: 'role_changed', category: 'team', label: 'Role Changed', description: "A team member's role was changed", defaultRoles: ['treasury_manager'] },

  // KYC/KYB
  { eventType: 'kyc_status_changed', category: 'kyc_kyb', label: 'KYC Status Changed', description: 'KYC verification status updated', defaultRoles: ['treasury_manager'], additionalRecipientKey: 'subjectUserId' },
  { eventType: 'kyb_status_changed', category: 'kyc_kyb', label: 'KYB Status Changed', description: 'KYB verification status updated', defaultRoles: ['treasury_manager'] },

  // Billing
  { eventType: 'payment_failed', category: 'billing', label: 'Payment Failed', description: 'Billing payment failed', defaultRoles: ['treasury_manager'] },
  { eventType: 'subscription_changed', category: 'billing', label: 'Subscription Changed', description: 'Subscription plan was changed', defaultRoles: ['treasury_manager'] },
];

export function getEventConfig(eventType: string): EventConfig | undefined {
  return EVENT_CATALOG.find((e) => e.eventType === eventType);
}

export function getEventsByCategory(category: NotificationCategory): EventConfig[] {
  return EVENT_CATALOG.filter((e) => e.category === category);
}
