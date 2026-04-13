-- Extend policy gate to 5 live + 3 disabled money-movement callsites:
--   live:     yield_transactions, fiat_transactions (ramps), scheduled_operations
--   disabled: fiat_payments (bank payments), swaps, bridge_transfers
--
-- Each table gets:
--   1. its status enum/CHECK extended with 'awaiting_approval' and 'denied'
--   2. a denial_reason TEXT column
--   3. an index on status for UI filtering
--
-- Note: swaps + bridge_transfers reuse the `payment_status` enum already
-- extended by 0050, so no enum change is needed there — only the column +
-- index. yield_transactions uses `yield_tx_status` which we extend here.
-- fiat_payments + scheduled_operations use TEXT + CHECK, so the CHECK
-- constraint is rebuilt. fiat_transactions uses TEXT with no CHECK, so
-- only the column + index applies.
--
-- audit_action gains one _blocked and one _requires_approval value per
-- new callsite, mirroring transfer_create_blocked / _requires_approval.
-- These allow the CFO audit trail to distinguish hold/deny outcomes from
-- normal creates on every movement kind.

-- ─────────────────────────────────────────────────────────────────────
-- 1. yield_tx_status enum: add awaiting_approval, denied
-- ─────────────────────────────────────────────────────────────────────

ALTER TYPE yield_tx_status ADD VALUE IF NOT EXISTS 'awaiting_approval';
ALTER TYPE yield_tx_status ADD VALUE IF NOT EXISTS 'denied';

-- ─────────────────────────────────────────────────────────────────────
-- 2. scheduled_operations: rebuild CHECK to include new statuses
-- ─────────────────────────────────────────────────────────────────────
-- Existing CHECK:
--   status IN ('pending', 'processing', 'awaiting_authorization',
--              'completed', 'failed', 'cancelled', 'expired')
-- awaiting_authorization is distinct from awaiting_approval — the former
-- was for MFA flows, the latter is for policy-gate approval requests.
-- We keep both to avoid breaking existing rows.

ALTER TABLE scheduled_operations DROP CONSTRAINT IF EXISTS scheduled_operations_status_check;
ALTER TABLE scheduled_operations ADD CONSTRAINT scheduled_operations_status_check
  CHECK (status IN (
    'pending', 'processing', 'awaiting_authorization',
    'awaiting_approval', 'denied',
    'completed', 'failed', 'cancelled', 'expired'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- 3. fiat_payments: rebuild CHECK to include new statuses
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE fiat_payments DROP CONSTRAINT IF EXISTS fiat_payments_status_check;
ALTER TABLE fiat_payments ADD CONSTRAINT fiat_payments_status_check
  CHECK (status IN (
    'pending', 'processing', 'awaiting_approval', 'denied',
    'completed', 'failed', 'cancelled'
  ));

-- ─────────────────────────────────────────────────────────────────────
-- 4. denial_reason columns on every extended table (+ length check)
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE yield_transactions   ADD COLUMN IF NOT EXISTS denial_reason TEXT;
ALTER TABLE fiat_transactions    ADD COLUMN IF NOT EXISTS denial_reason TEXT;
ALTER TABLE scheduled_operations ADD COLUMN IF NOT EXISTS denial_reason TEXT;
ALTER TABLE fiat_payments        ADD COLUMN IF NOT EXISTS denial_reason TEXT;
ALTER TABLE swaps                ADD COLUMN IF NOT EXISTS denial_reason TEXT;
ALTER TABLE bridge_transfers     ADD COLUMN IF NOT EXISTS denial_reason TEXT;

ALTER TABLE yield_transactions   DROP CONSTRAINT IF EXISTS yield_transactions_denial_reason_length_check;
ALTER TABLE yield_transactions   ADD CONSTRAINT yield_transactions_denial_reason_length_check
  CHECK (denial_reason IS NULL OR LENGTH(denial_reason) <= 200);

ALTER TABLE fiat_transactions    DROP CONSTRAINT IF EXISTS fiat_transactions_denial_reason_length_check;
ALTER TABLE fiat_transactions    ADD CONSTRAINT fiat_transactions_denial_reason_length_check
  CHECK (denial_reason IS NULL OR LENGTH(denial_reason) <= 200);

ALTER TABLE scheduled_operations DROP CONSTRAINT IF EXISTS scheduled_operations_denial_reason_length_check;
ALTER TABLE scheduled_operations ADD CONSTRAINT scheduled_operations_denial_reason_length_check
  CHECK (denial_reason IS NULL OR LENGTH(denial_reason) <= 200);

ALTER TABLE fiat_payments        DROP CONSTRAINT IF EXISTS fiat_payments_denial_reason_length_check;
ALTER TABLE fiat_payments        ADD CONSTRAINT fiat_payments_denial_reason_length_check
  CHECK (denial_reason IS NULL OR LENGTH(denial_reason) <= 200);

ALTER TABLE swaps                DROP CONSTRAINT IF EXISTS swaps_denial_reason_length_check;
ALTER TABLE swaps                ADD CONSTRAINT swaps_denial_reason_length_check
  CHECK (denial_reason IS NULL OR LENGTH(denial_reason) <= 200);

ALTER TABLE bridge_transfers     DROP CONSTRAINT IF EXISTS bridge_transfers_denial_reason_length_check;
ALTER TABLE bridge_transfers     ADD CONSTRAINT bridge_transfers_denial_reason_length_check
  CHECK (denial_reason IS NULL OR LENGTH(denial_reason) <= 200);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Status indexes for UI filtering
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS yield_transactions_status_idx   ON yield_transactions   (status);
CREATE INDEX IF NOT EXISTS fiat_transactions_status_idx    ON fiat_transactions    (status);
CREATE INDEX IF NOT EXISTS swaps_status_idx                ON swaps                (status);
CREATE INDEX IF NOT EXISTS bridge_transfers_status_idx     ON bridge_transfers     (status);
-- scheduled_operations + fiat_payments already have status-scoped partial indexes
-- from their origin migrations; adding a plain status index would be redundant.

-- ─────────────────────────────────────────────────────────────────────
-- 6. audit_action additions — per-kind _blocked and _requires_approval
-- ─────────────────────────────────────────────────────────────────────
-- Keeps audit log explicit about which rail was gated. yield_deposit,
-- yield_withdraw, onramp_execute, offramp_execute, fiat_payment_create,
-- scheduled_operation_create already exist; we add their blocked/approval
-- variants. swap_create/bridge_create don't exist yet (their POSTs are
-- 501-disabled) but we add them now so wiring them up when the routes
-- come back online is a code-only change.

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'yield_deposit_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'yield_deposit_requires_approval';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'yield_withdraw_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'yield_withdraw_requires_approval';

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'onramp_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'onramp_requires_approval';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'offramp_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'offramp_requires_approval';

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'scheduled_operation_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'scheduled_operation_requires_approval';

-- Disabled-route futures — enum values added now so re-enabling is
-- a code-only change.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'fiat_payment_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'fiat_payment_requires_approval';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'swap_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'swap_create_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'swap_create_requires_approval';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'bridge_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'bridge_create_blocked';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'bridge_create_requires_approval';
