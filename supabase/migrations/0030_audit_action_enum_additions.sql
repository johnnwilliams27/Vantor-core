-- Add missing audit_action enum values for actions already being logged in code

-- Scheduled operations
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'scheduled_operation_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'scheduled_operation_execute';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'scheduled_operation_approve';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'scheduled_operation_flagged';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'scheduled_operation_cancel';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'scheduled_operation_expire';

-- Fiat payments
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'fiat_payment_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'fiat_payment_execute';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'fiat_payment_settle';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'fiat_payment_cancel';

-- Swap quote
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'swap_quote';

-- Test mode
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'test_mode_toggle';

-- Invoice
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_update';
