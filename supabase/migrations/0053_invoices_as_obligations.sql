-- ============================================================
-- 0053_invoices_as_obligations.sql
--
-- Promote ERP-synced invoices into the canonical obligations
-- table via dual-write. Before this migration the rules engine
-- queried `invoices` directly in collectObligations() while
-- manual + recurring obligations went through ForecastService.
-- After: every consumer reads obligations, and ERP sync writes
-- BOTH invoices (ledger detail for the Invoices report) AND
-- obligations (forecast-relevant view) keyed on source_ref_id.
--
-- Changes:
--   1. invoices.direction — AR vs AP. Defaults 'outflow' (AP) so
--      existing rows (all current invoices are vendor bills) map
--      cleanly. Future AR sync paths can set direction='inflow'.
--   2. obligations.source_ref_id — typed FK to invoices(id) with
--      ON DELETE SET NULL so invoice deletes don't cascade into
--      obligation history. Partial unique index enforces 1:1
--      linkage for source='erp_sync' rows (keyed upsert target).
--   3. Backfill: promote every invoices row into an obligations
--      row. Idempotent via the unique index + WHERE NOT EXISTS.
--      Stablecoin tokens (USDC/USDT) are kept as native currency;
--      at ~1 USD par they pass through FX as 1.0 without loss.
-- ============================================================

-- 1. Direction on invoices -------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS direction obligation_type NOT NULL DEFAULT 'outflow';

-- 2. Typed FK from obligations back to the source invoice ------
ALTER TABLE obligations
  ADD COLUMN IF NOT EXISTS source_ref_id UUID
    REFERENCES invoices(id) ON DELETE SET NULL;

-- Unique per (source='erp_sync', source_ref_id) so ERP sync can
-- upsert safely. Partial index to scope only to ERP-synced rows;
-- manual + recurring_rule obligations don't use source_ref_id.
CREATE UNIQUE INDEX IF NOT EXISTS ux_obligations_erp_source_ref
  ON obligations(source_ref_id)
  WHERE source = 'erp_sync' AND source_ref_id IS NOT NULL;

-- 3. Backfill existing invoices into obligations ----------------
-- `label` is NOT NULL on obligations; use "Invoice {number}" as a
-- stable human-readable label. `due_date` is also NOT NULL;
-- invoices may have NULL due_date, so fall back to today + 30d
-- (matches the default AP net-30 assumption).
INSERT INTO obligations (
  user_id, enterprise_id, label, amount, amount_usd, currency,
  direction, due_date, confidence, source, source_ref_id, recurrence,
  status, is_active, is_recurring, erp_reference, metadata
)
SELECT
  i.user_id,
  i.enterprise_id,
  CONCAT('Invoice ', i.invoice_number),
  i.amount,
  i.amount,                                             -- legacy mirror (stablecoin @ ~1 USD)
  COALESCE(i.token::text, 'USDC'),                      -- 'USDC', 'USDT', etc. — native currency.
                                                        -- Defensive COALESCE: a handful of legacy
                                                        -- prod invoices have NULL token despite the
                                                        -- NOT NULL schema constraint (pre-constraint
                                                        -- data). USDC is the safe default.
  i.direction,
  COALESCE(i.due_date, CURRENT_DATE + INTERVAL '30 days')::date,
  'confirmed'::obligation_confidence,
  'erp_sync'::obligation_source,
  i.id,
  'once'::obligation_recurrence,
  CASE i.status
    WHEN 'paid' THEN 'paid'::obligation_status
    WHEN 'cancelled' THEN 'cancelled'::obligation_status
    ELSE 'upcoming'::obligation_status
  END,
  (i.status NOT IN ('paid', 'cancelled')),              -- is_active
  false,                                                -- is_recurring (legacy mirror, once)
  i.erp_invoice_id,
  jsonb_build_object(
    'invoice_number', i.invoice_number,
    'description', i.description,
    'chain', i.chain::text
  )
FROM invoices i
WHERE NOT EXISTS (
  SELECT 1 FROM obligations o
  WHERE o.source = 'erp_sync' AND o.source_ref_id = i.id
);
