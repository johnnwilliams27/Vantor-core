CREATE TABLE fiat_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id         UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  from_bank_account_id  UUID NOT NULL REFERENCES bank_accounts(id),
  to_bank_name          TEXT NOT NULL,
  to_account_number     TEXT NOT NULL,
  to_routing_number     TEXT NOT NULL,
  to_account_holder     TEXT NOT NULL,
  amount                NUMERIC(36, 6) NOT NULL,
  currency              TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP')),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  scheduled_for         TIMESTAMPTZ,
  executed_at           TIMESTAMPTZ,
  settled_at            TIMESTAMPTZ,
  estimated_settlement  TIMESTAMPTZ,
  provider_payment_id   TEXT,
  invoice_id            UUID REFERENCES invoices(id),
  memo                  TEXT,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fiat_payments_pending
  ON fiat_payments(status, estimated_settlement)
  WHERE status = 'pending';

CREATE INDEX idx_fiat_payments_scheduled
  ON fiat_payments(status, scheduled_for)
  WHERE status = 'pending' AND scheduled_for IS NOT NULL;

CREATE INDEX idx_fiat_payments_user
  ON fiat_payments(user_id, enterprise_id);

ALTER TABLE fiat_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own fiat payments"
  ON fiat_payments FOR SELECT
  USING (user_id = auth.uid() OR enterprise_id IN (
    SELECT enterprise_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert own fiat payments"
  ON fiat_payments FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own fiat payments"
  ON fiat_payments FOR UPDATE
  USING (user_id = auth.uid());

CREATE TRIGGER set_fiat_payments_updated_at
  BEFORE UPDATE ON fiat_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
