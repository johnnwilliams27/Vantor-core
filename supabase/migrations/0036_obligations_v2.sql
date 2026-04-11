-- ============================================================
-- 0036_obligations_v2.sql  —  Extend manual_obligations into
-- a full obligations model and rename to `obligations`.
-- Backfills legacy is_recurring/recurrence_days into the new
-- recurrence enum and mirrors amount_usd into native `amount`.
-- Legacy columns retained one release, marked deprecated.
-- ============================================================

-- --- Enums -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_type') THEN
    CREATE TYPE obligation_type AS ENUM ('outflow', 'inflow');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_confidence') THEN
    CREATE TYPE obligation_confidence AS ENUM ('confirmed', 'expected', 'estimated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_source') THEN
    CREATE TYPE obligation_source AS ENUM ('manual', 'erp_sync', 'recurring_rule');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_status') THEN
    CREATE TYPE obligation_status AS ENUM ('upcoming', 'paid', 'missed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'obligation_recurrence') THEN
    CREATE TYPE obligation_recurrence AS ENUM
      ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'custom');
  END IF;
END $$;

-- --- New columns on manual_obligations -------------------------
ALTER TABLE manual_obligations
  ADD COLUMN IF NOT EXISTS direction          obligation_type       NOT NULL DEFAULT 'outflow',
  ADD COLUMN IF NOT EXISTS currency           TEXT                  NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS asset              TEXT,
  ADD COLUMN IF NOT EXISTS amount             NUMERIC(36,6),
  ADD COLUMN IF NOT EXISTS source_account_id  UUID,
  ADD COLUMN IF NOT EXISTS source_venue_kind  TEXT,
  ADD COLUMN IF NOT EXISTS confidence         obligation_confidence NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS source             obligation_source     NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS status             obligation_status     NOT NULL DEFAULT 'upcoming',
  ADD COLUMN IF NOT EXISTS recurrence         obligation_recurrence NOT NULL DEFAULT 'once',
  ADD COLUMN IF NOT EXISTS recurrence_cron    TEXT,
  ADD COLUMN IF NOT EXISTS counterparty_id    UUID,
  ADD COLUMN IF NOT EXISTS erp_reference      TEXT,
  ADD COLUMN IF NOT EXISTS recurring_parent_id UUID,
  ADD COLUMN IF NOT EXISTS tags               TEXT[]                NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metadata           JSONB                 NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS paid_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_tx_ref  TEXT;

-- Backfill: legacy is_recurring + recurrence_days → recurrence enum
UPDATE manual_obligations
SET recurrence = CASE
  WHEN is_recurring AND recurrence_days = 7   THEN 'weekly'::obligation_recurrence
  WHEN is_recurring AND recurrence_days = 14  THEN 'biweekly'::obligation_recurrence
  WHEN is_recurring AND recurrence_days = 30  THEN 'monthly'::obligation_recurrence
  WHEN is_recurring AND recurrence_days = 90  THEN 'quarterly'::obligation_recurrence
  WHEN is_recurring AND recurrence_days = 365 THEN 'annual'::obligation_recurrence
  WHEN is_recurring                           THEN 'custom'::obligation_recurrence
  ELSE 'once'::obligation_recurrence
END
WHERE recurrence = 'once' AND is_recurring IS DISTINCT FROM false;

-- Mirror amount_usd → amount for legacy rows
UPDATE manual_obligations SET amount = amount_usd WHERE amount IS NULL;
ALTER TABLE manual_obligations ALTER COLUMN amount SET NOT NULL;

-- Deprecation comments
COMMENT ON COLUMN manual_obligations.is_recurring    IS 'DEPRECATED: use recurrence enum';
COMMENT ON COLUMN manual_obligations.recurrence_days IS 'DEPRECATED: use recurrence enum';
COMMENT ON COLUMN manual_obligations.amount_usd      IS 'DEPRECATED: use amount + currency';

-- --- Rename table ----------------------------------------------
ALTER TABLE manual_obligations RENAME TO obligations;

-- --- FK constraints we couldn't add during ALTER ADD COLUMN ----
ALTER TABLE obligations
  ADD CONSTRAINT obligations_recurring_parent_fk
    FOREIGN KEY (recurring_parent_id) REFERENCES obligations(id) ON DELETE CASCADE;

-- counterparty_id FK (counterparties table exists per 0031)
ALTER TABLE obligations
  ADD CONSTRAINT obligations_counterparty_fk
    FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE SET NULL;

-- --- Indexes ---------------------------------------------------
DROP INDEX IF EXISTS idx_manual_obligations_user_due;
DROP INDEX IF EXISTS idx_manual_obligations_enterprise;

CREATE INDEX IF NOT EXISTS idx_obligations_enterprise_due
  ON obligations(enterprise_id, due_date) WHERE status = 'upcoming';
CREATE INDEX IF NOT EXISTS idx_obligations_user_due
  ON obligations(user_id, due_date) WHERE status = 'upcoming';
CREATE INDEX IF NOT EXISTS idx_obligations_recurring_parent
  ON obligations(recurring_parent_id) WHERE recurring_parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_obligations_status
  ON obligations(enterprise_id, status, due_date);

-- --- RLS policy rename -----------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'obligations' AND policyname = 'users own manual_obligations') THEN
    DROP POLICY "users own manual_obligations" ON obligations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'obligations' AND policyname = 'enterprise obligations') THEN
    CREATE POLICY "enterprise obligations" ON obligations
      FOR ALL USING (
        enterprise_id = auth_user_enterprise_id()
        OR (enterprise_id IS NULL AND user_id = auth.uid())
      );
  END IF;
END $$;

-- --- Audit actions ---------------------------------------------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'obligation_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'obligation_update';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'obligation_delete';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'obligation_materialize';
