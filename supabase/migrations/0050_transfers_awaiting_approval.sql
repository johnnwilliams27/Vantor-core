-- Add awaiting_approval + denied to payment_status enum + denial_reason column.
-- Enables the policy gate to mark transfers as pending policy review between
-- body-parse and client-sign, and to capture denial context for audit.
--
-- Defensive approach: at POST time the row is inserted with
-- status='awaiting_approval', then flipped to 'pending' if the gate returns
-- allow_auto. Ensures no signable row exists before the gate ran.
--
-- Note: transfers.status is of type `payment_status` (enum from 0001),
-- NOT a CHECK-constrained TEXT. Extending the enum is the idiomatic
-- approach in Postgres. IF NOT EXISTS makes this idempotent.

ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'awaiting_approval';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'denied';

-- Column for capturing why a transfer was denied. Populated on:
--   - Gate throw: set to the reason_code (policy_blocked, hard_limit_breached, etc.)
--   - Approval denial: set to denial_reason (manual, stale_reeval, expired)
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS denial_reason TEXT;

-- Index for UI queries that filter by status (e.g., "my pending approvals").
CREATE INDEX IF NOT EXISTS transfers_status_idx ON transfers (status);

-- Reasonable cap on denial_reason length to prevent misuse.
ALTER TABLE transfers DROP CONSTRAINT IF EXISTS transfers_denial_reason_length_check;
ALTER TABLE transfers ADD CONSTRAINT transfers_denial_reason_length_check
  CHECK (denial_reason IS NULL OR LENGTH(denial_reason) <= 200);

-- Audit action values for policy-gate outcomes. Keeps the CFO audit trail
-- explicit: an approval-requested transfer is distinct from a blocked one
-- and from a normal create.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'transfer_create_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'transfer_create_requires_approval';
