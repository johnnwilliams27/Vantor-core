-- Add collected_via column to usage_fees to distinguish Bridge-collected fees
-- (auto-deducted at the rail) from Stripe-invoiced fees (billed monthly to card).
-- This prevents double-charging and supports the hybrid collection model.

ALTER TABLE usage_fees
  ADD COLUMN IF NOT EXISTS collected_via TEXT NOT NULL DEFAULT 'stripe_invoice'
  CHECK (collected_via IN ('bridge', 'stripe_invoice'));

CREATE INDEX IF NOT EXISTS idx_usage_fees_collected_via
  ON usage_fees(enterprise_id, billing_period, collected_via);

NOTIFY pgrst, 'reload schema';
