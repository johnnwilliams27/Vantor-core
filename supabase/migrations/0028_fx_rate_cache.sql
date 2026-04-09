-- 0028_fx_rate_cache.sql
-- Cache for live FX rates from exchangeratesapi.io

CREATE TABLE fx_rate_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency TEXT NOT NULL DEFAULT 'USD',
  target_currency TEXT NOT NULL,
  rate NUMERIC NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(base_currency, target_currency)
);

ALTER TABLE fx_rate_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read FX rate cache"
  ON fx_rate_cache FOR SELECT
  USING (true);
