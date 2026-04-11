import type { UserRole } from './database';

export type NotificationCategory =
  | 'treasury_ai'
  | 'transactions'
  | 'swaps'
  | 'ramps'
  | 'bridges'
  | 'payments'
  | 'yield'
  | 'compliance'
  | 'invoices'
  | 'scheduled_ops'
  | 'wallets_accounts'
  | 'treasury_rules'
  | 'team'
  | 'kyc_kyb'
  | 'billing';

export type NotificationEventType =
  | 'recommendation_pending'
  | 'recommendation_auto_executed'
  | 'recommendation_approved'
  | 'recommendation_rejected'
  | 'recommendation_expired'
  | 'recommendation_daily'
  | 'insight_critical'
  | 'insight_warning'
  | 'transfer_completed'
  | 'transfer_scheduled'
  | 'swap_completed'
  | 'onramp_completed'
  | 'offramp_completed'
  | 'bridge_completed'
  | 'payment_sent'
  | 'payment_received'
  | 'yield_deposit_confirmed'
  | 'yield_withdrawal_confirmed'
  | 'sanctions_alert'
  | 'travel_rule_notification'
  | 'invoice_synced'
  | 'invoice_overdue'
  | 'scheduled_swap_executed'
  | 'scheduled_bridge_executed'
  | 'scheduled_ramp_executed'
  | 'scheduled_operation_flagged'
  | 'scheduled_operation_failed'
  | 'wallet_connected'
  | 'wallet_disconnected'
  | 'bank_account_linked'
  | 'bank_account_removed'
  | 'erp_connected'
  | 'erp_disconnected'
  | 'treasury_rule_created'
  | 'treasury_rule_updated'
  | 'member_invited'
  | 'member_removed'
  | 'role_changed'
  | 'kyc_status_changed'
  | 'kyb_status_changed'
  | 'payment_failed'
  | 'subscription_changed';

export interface Notification {
  id: string;
  enterprise_id: string;
  user_id: string;
  event_type: NotificationEventType;
  category: NotificationCategory;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  link: string | null;
  read: boolean;
  emailed: boolean;
  slacked: boolean;
  created_at: string;
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  enterprise_id: string;
  event_type: NotificationEventType;
  in_app_enabled: boolean;
  email_enabled: boolean;
  slack_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventConfig {
  eventType: NotificationEventType;
  category: NotificationCategory;
  label: string;
  description: string;
  defaultRoles: UserRole[];
  additionalRecipientKey?: string;
}

export interface NotifyParams {
  eventType: NotificationEventType;
  enterpriseId: string;
  title: string;
  body: string;
  link?: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
  additionalUserIds?: string[];
}
