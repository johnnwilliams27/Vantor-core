-- 0026_eu_banking_yield_tier.sql
-- Enterprise country
ALTER TABLE enterprises ADD COLUMN country TEXT;

-- Bank account provider tracking
ALTER TABLE bank_accounts ADD COLUMN banking_provider TEXT NOT NULL DEFAULT 'manual'
  CHECK (banking_provider IN ('stripe_fc', 'belvo', 'manual'));

-- Stripe Financial Connections fields
ALTER TABLE bank_accounts ADD COLUMN stripe_fc_account_id TEXT;
ALTER TABLE bank_accounts ADD COLUMN iban TEXT;

-- Belvo fields (Brazil/Mexico)
ALTER TABLE bank_accounts ADD COLUMN belvo_link_id TEXT;
ALTER TABLE bank_accounts ADD COLUMN belvo_account_id TEXT;

-- Yield rate cache
CREATE TABLE yield_rate_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol TEXT NOT NULL,
  token TEXT NOT NULL,
  chain TEXT NOT NULL,
  supply_apy NUMERIC NOT NULL,
  reward_apy NUMERIC NOT NULL DEFAULT 0,
  total_apy NUMERIC NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_stale BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(protocol, token, chain)
);

-- Ondo KYC tracking
CREATE TABLE ondo_kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(enterprise_id, wallet_address)
);
