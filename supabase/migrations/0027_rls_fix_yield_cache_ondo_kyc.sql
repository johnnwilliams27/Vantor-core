-- 0027_rls_fix_yield_cache_ondo_kyc.sql
-- Enable RLS on tables created in 0026 that were missing it

-- yield_rate_cache: public read (rates are not sensitive), service-role writes
ALTER TABLE yield_rate_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read yield rate cache"
  ON yield_rate_cache FOR SELECT
  USING (true);

-- ondo_kyc_verifications: enterprise-scoped access
ALTER TABLE ondo_kyc_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own enterprise Ondo KYC"
  ON ondo_kyc_verifications FOR SELECT
  USING (
    enterprise_id IN (
      SELECT enterprise_id FROM user_profiles WHERE id = auth.uid()
    )
  );
