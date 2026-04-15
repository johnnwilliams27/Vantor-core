-- 0059_move_internal_tables.sql
-- Move CI/observability tables to _internal schema (remove PostgREST exposure)
-- Fixes: xero_ci_bootstrap contains refresh_token without RLS
--        policy_forecast_stub_calls exposes enterprise observability data

-- Create _internal schema (private, not exposed to PostgREST)
CREATE SCHEMA IF NOT EXISTS _internal;

-- Revoke default public access on the schema
REVOKE ALL ON SCHEMA _internal FROM public;
REVOKE ALL ON SCHEMA _internal FROM authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Move xero_ci_bootstrap to _internal
-- ════════════════════════════════════════════════════════════════════

-- Create table in _internal schema
CREATE TABLE IF NOT EXISTS _internal.xero_ci_bootstrap (
  id             INTEGER PRIMARY KEY DEFAULT 1,
  refresh_token  TEXT NOT NULL,
  rotated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT xero_ci_bootstrap_singleton CHECK (id = 1)
);

-- Migrate any existing data from public schema
INSERT INTO _internal.xero_ci_bootstrap (id, refresh_token, rotated_at)
SELECT id, refresh_token, rotated_at FROM public.xero_ci_bootstrap
ON CONFLICT DO NOTHING;

-- Drop old table from public schema
DROP TABLE IF EXISTS public.xero_ci_bootstrap CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- Move policy_forecast_stub_calls to _internal
-- ════════════════════════════════════════════════════════════════════

-- Create table in _internal schema
CREATE TABLE IF NOT EXISTS _internal.policy_forecast_stub_calls (
  id              BIGSERIAL PRIMARY KEY,
  enterprise_id   UUID NOT NULL,
  method          TEXT NOT NULL,
  args_json       JSONB,
  called_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_forecast_stub_calls_enterprise_called
  ON _internal.policy_forecast_stub_calls (enterprise_id, called_at DESC);

COMMENT ON TABLE _internal.policy_forecast_stub_calls IS
  'Engineering observability: counts of forecast stub usage. Internal observability table. Tracks rollout urgency of the real forecast module. Not exposed to API.';

-- Migrate any existing data from public schema
INSERT INTO _internal.policy_forecast_stub_calls (id, enterprise_id, method, args_json, called_at)
SELECT id, enterprise_id, method, args_json, called_at FROM public.policy_forecast_stub_calls
ON CONFLICT DO NOTHING;

-- Drop old table from public schema
DROP TABLE IF EXISTS public.policy_forecast_stub_calls CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- Grant service_role (backend-only) access to _internal tables
-- ════════════════════════════════════════════════════════════════════

GRANT USAGE ON SCHEMA _internal TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA _internal TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA _internal TO service_role;
