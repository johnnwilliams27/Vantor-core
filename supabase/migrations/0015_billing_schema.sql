-- 0015_billing_schema.sql
-- Billing, subscriptions, KYC/KYB, invitations, usage fees

-- New enum for subscription tiers
CREATE TYPE subscription_tier AS ENUM ('lite', 'starter', 'growth', 'scale', 'enterprise');

-- Add subscription_tier to enterprises (denormalized cache)
ALTER TABLE enterprises ADD COLUMN subscription_tier subscription_tier NOT NULL DEFAULT 'lite';

-- Deprecate existing kyc_status column on enterprises
COMMENT ON COLUMN enterprises.kyc_status IS 'DEPRECATED: Use kyb_verifications table instead';

-- Subscriptions table (source of truth for tier)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL UNIQUE REFERENCES enterprises(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  tier subscription_tier NOT NULL DEFAULT 'lite',
  status TEXT NOT NULL DEFAULT 'active',
  custom_price NUMERIC(10,2),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment methods (cached card info for display)
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT NOT NULL,
  card_brand TEXT,
  card_last4 TEXT,
  card_exp_month INTEGER,
  card_exp_year INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ERP add-ons (paid additional ERPs beyond included 1)
CREATE TABLE erp_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  erp_configuration_id UUID NOT NULL REFERENCES erp_configurations(id) ON DELETE CASCADE,
  stripe_subscription_item_id TEXT,
  monthly_cost NUMERIC(10,2) NOT NULL DEFAULT 1500.00,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usage fees (per-transaction Vantor fees for billing)
CREATE TABLE usage_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('ramp', 'swap', 'bridge')),
  transaction_id UUID NOT NULL,
  notional_amount NUMERIC(36,9) NOT NULL,
  fee_rate NUMERIC(10,6) NOT NULL DEFAULT 0.001,
  fee_amount NUMERIC(36,9) NOT NULL,
  billing_period DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook events (idempotency deduplication)
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('stripe', 'persona')),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Invitations (admin invite flow)
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES user_profiles(id),
  inviter_email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- KYC verifications (per-user identity verification)
CREATE TABLE kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  persona_inquiry_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- KYB verifications (per-enterprise business verification)
CREATE TABLE kyb_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL UNIQUE REFERENCES enterprises(id) ON DELETE CASCADE,
  persona_inquiry_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  legal_entity_name TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atomic tier update function (used by webhook handlers)
CREATE OR REPLACE FUNCTION update_subscription_tier(
  p_sub_id UUID,
  p_enterprise_id UUID,
  p_tier subscription_tier,
  p_status TEXT,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
  UPDATE subscriptions SET tier=p_tier, status=p_status, current_period_start=p_period_start, current_period_end=p_period_end, updated_at=NOW() WHERE id=p_sub_id;
  UPDATE enterprises SET subscription_tier=p_tier WHERE id=p_enterprise_id;
END;
$$ LANGUAGE plpgsql;

-- Indexes for common queries
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_usage_fees_enterprise_period ON usage_fees(enterprise_id, billing_period);
CREATE INDEX idx_usage_fees_billing_period ON usage_fees(billing_period);
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX idx_kyc_verifications_user ON kyc_verifications(user_id);
CREATE INDEX idx_kyb_verifications_enterprise ON kyb_verifications(enterprise_id);
CREATE INDEX idx_payment_methods_enterprise ON payment_methods(enterprise_id);

-- RLS policies
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_verifications ENABLE ROW LEVEL SECURITY;

-- Service role has full access (all API routes use service role client)
-- No user-facing RLS policies needed since all access is through API routes
