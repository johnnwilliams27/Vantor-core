-- 0034_yield_rate_cache_tvl.sql
-- Add TVL tracking to the yield rate cache so the protocol cards can
-- surface real pool depth alongside APY, and so the slippage engine
-- can stop relying on hardcoded mock TVL constants.

ALTER TABLE yield_rate_cache
  ADD COLUMN IF NOT EXISTS tvl_usd NUMERIC;

-- Nullable: if a fetcher can't determine TVL (e.g. upstream API shape
-- change or temporary failure), we keep the row and surface NULL
-- rather than failing the whole upsert.

CREATE INDEX IF NOT EXISTS idx_yield_rate_cache_protocol_chain
  ON yield_rate_cache(protocol, chain);
