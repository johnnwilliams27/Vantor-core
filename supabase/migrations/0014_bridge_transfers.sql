-- Bridge transfers table — stores cross-chain bridge operations
-- Separate from swaps (token swaps on the same chain)

CREATE TABLE IF NOT EXISTS bridge_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  enterprise_id UUID REFERENCES enterprises(id),
  from_wallet_id UUID REFERENCES wallets(id),
  to_wallet_id UUID REFERENCES wallets(id),
  token token_symbol NOT NULL,
  amount NUMERIC(36,6) NOT NULL,
  received_amount NUMERIC(36,6),
  bridge_fee NUMERIC(36,6) DEFAULT 0,
  from_chain chain_type NOT NULL,
  to_chain chain_type NOT NULL,
  provider TEXT NOT NULL, -- 'cctp' or 'layerzero'
  tx_hash TEXT,
  status payment_status NOT NULL DEFAULT 'pending',
  slippage_bps INTEGER,
  estimated_arrival_minutes INTEGER,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bridge_transfers_user ON bridge_transfers(user_id);
CREATE INDEX IF NOT EXISTS idx_bridge_transfers_enterprise ON bridge_transfers(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_bridge_transfers_status ON bridge_transfers(status);

-- RLS
ALTER TABLE bridge_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY bridge_transfers_user_policy ON bridge_transfers
  FOR ALL USING (user_id = auth.uid());

-- Add bridge audit actions
DO $$ BEGIN
  ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'bridge_execute';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
