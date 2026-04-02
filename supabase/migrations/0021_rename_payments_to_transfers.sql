-- Rename payments → transfers
ALTER TABLE payments RENAME TO transfers;
ALTER TABLE payment_attempts RENAME TO transfer_attempts;

-- Rename columns
ALTER TABLE transfer_attempts RENAME COLUMN payment_id TO transfer_id;

-- Rename indexes
ALTER INDEX IF EXISTS idx_payments_scheduled RENAME TO idx_transfers_scheduled;

-- Rename audit action enum values
ALTER TYPE audit_action RENAME VALUE 'payment_create' TO 'transfer_create';
ALTER TYPE audit_action RENAME VALUE 'payment_execute' TO 'transfer_execute';
ALTER TYPE audit_action RENAME VALUE 'payment_cancel' TO 'transfer_cancel';
ALTER TYPE audit_action RENAME VALUE 'payment_schedule' TO 'transfer_schedule';
