-- Scheduled operations for swaps, bridges, and ramps
CREATE TABLE scheduled_operations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id     UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('swap', 'bridge', 'ramp')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'awaiting_authorization', 'completed', 'failed', 'cancelled', 'expired')),
  scheduled_for     TIMESTAMPTZ NOT NULL,
  params            JSONB NOT NULL,
  initial_quote     JSONB NOT NULL,
  execution_quote   JSONB,
  deviation_bps     INTEGER,
  tolerance_bps     INTEGER NOT NULL,
  executed_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  tx_hash           TEXT,
  error_message     TEXT,
  memo              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_ops_pending
  ON scheduled_operations(status, scheduled_for)
  WHERE status = 'pending' AND scheduled_for IS NOT NULL;

CREATE INDEX idx_scheduled_ops_expiring
  ON scheduled_operations(status, expires_at)
  WHERE status = 'awaiting_authorization' AND expires_at IS NOT NULL;

CREATE INDEX idx_scheduled_ops_user
  ON scheduled_operations(user_id, enterprise_id);

-- Add scheduled_operation_id + metadata to transaction tables
ALTER TABLE swaps
  ADD COLUMN IF NOT EXISTS scheduled_operation_id UUID REFERENCES scheduled_operations(id),
  ADD COLUMN IF NOT EXISTS scheduled_metadata JSONB;

ALTER TABLE bridge_transfers
  ADD COLUMN IF NOT EXISTS scheduled_operation_id UUID REFERENCES scheduled_operations(id),
  ADD COLUMN IF NOT EXISTS scheduled_metadata JSONB;

ALTER TABLE fiat_transactions
  ADD COLUMN IF NOT EXISTS scheduled_operation_id UUID REFERENCES scheduled_operations(id),
  ADD COLUMN IF NOT EXISTS scheduled_metadata JSONB;

-- RLS policies
ALTER TABLE scheduled_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scheduled operations"
  ON scheduled_operations FOR SELECT
  USING (user_id = auth.uid() OR enterprise_id IN (
    SELECT enterprise_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert own scheduled operations"
  ON scheduled_operations FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own scheduled operations"
  ON scheduled_operations FOR UPDATE
  USING (user_id = auth.uid());

-- Updated_at trigger
CREATE TRIGGER set_scheduled_operations_updated_at
  BEFORE UPDATE ON scheduled_operations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
