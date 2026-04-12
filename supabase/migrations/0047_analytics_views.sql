-- ============================================================
-- 0047_analytics_views.sql — Analytics views table + standard views
-- Phase B of the Forecast Analytics effort.
-- ============================================================

-- analytics_views: saved view configurations for the analytics engine.
-- Standard views have enterprise_id IS NULL and kind='standard'.
-- Custom views (Phase C) will have enterprise_id set and kind='custom'.
CREATE TABLE IF NOT EXISTS analytics_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id   UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  label           TEXT NOT NULL,
  description     TEXT,
  kind            TEXT NOT NULL DEFAULT 'standard'
                    CHECK (kind IN ('standard', 'custom')),
  chart_type      TEXT NOT NULL DEFAULT 'table'
                    CHECK (chart_type IN ('kpi', 'line', 'bar', 'table', 'donut')),
  config          JSONB NOT NULL DEFAULT '{}',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Standard views: unique slug per NULL enterprise_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_views_standard_slug
  ON analytics_views(slug) WHERE enterprise_id IS NULL;

-- Custom views: unique slug per enterprise
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_views_enterprise_slug
  ON analytics_views(enterprise_id, slug) WHERE enterprise_id IS NOT NULL;

-- Lookup by enterprise
CREATE INDEX IF NOT EXISTS idx_analytics_views_enterprise
  ON analytics_views(enterprise_id) WHERE enterprise_id IS NOT NULL;

-- RLS
ALTER TABLE analytics_views ENABLE ROW LEVEL SECURITY;

-- Anyone can read standard views
CREATE POLICY "read_standard_views" ON analytics_views
  FOR SELECT USING (kind = 'standard' AND enterprise_id IS NULL);

-- Enterprise members can CRUD their own custom views
CREATE POLICY "enterprise_custom_views" ON analytics_views
  FOR ALL USING (enterprise_id = auth_user_enterprise_id());

-- Seed the 12 standard views
INSERT INTO analytics_views (slug, label, description, kind, chart_type, config, sort_order) VALUES
  ('treasury-summary', 'Treasury Summary',
   'Balance KPIs: total, fiat, stablecoin, DeFi, idle cash, coverage ratio',
   'standard', 'kpi',
   '{"measures":["total_balance_usd","fiat_balance_usd","stablecoin_balance_usd","defi_balance_usd","idle_cash_usd","coverage_ratio"]}',
   1),
  ('balance-history', 'Balance History',
   'Daily balance trend across fiat, stablecoin, and DeFi positions',
   'standard', 'line',
   '{"measures":["fiat_balance_usd","stablecoin_balance_usd","defi_balance_usd"],"primaryDimension":"time","granularity":"day"}',
   2),
  ('obligation-coverage', 'Obligation Coverage',
   'Weekly obligation total vs bank balance with coverage ratio',
   'standard', 'bar',
   '{"measures":["obligation_total_usd","fiat_balance_usd","coverage_ratio"],"primaryDimension":"time","granularity":"week"}',
   3),
  ('forecast-vs-actuals', 'Forecast vs Actuals',
   'Compare projected balance from forecasts against actual treasury state',
   'standard', 'line',
   '{"measures":["forecast_projected_usd","total_balance_usd"],"primaryDimension":"time","granularity":"day"}',
   4),
  ('ramp-activity', 'Ramp Activity',
   'On-ramp and off-ramp volume by direction over time',
   'standard', 'bar',
   '{"measures":["ramp_volume_usd","ramp_count","ramp_fee_usd"],"primaryDimension":"direction"}',
   5),
  ('transfer-volume', 'Transfer Volume',
   'Transfer detail rows with status and chain filters',
   'standard', 'table',
   '{"measures":["transfer_volume_usd","transfer_count"],"primaryDimension":"status"}',
   6),
  ('swap-activity', 'Swap Activity',
   'Swap detail rows with chain filter',
   'standard', 'table',
   '{"measures":["swap_volume_usd","swap_count"],"primaryDimension":"chain"}',
   7),
  ('invoice-aging', 'Invoice Aging',
   'Outstanding invoices bucketed by age (1-30d, 31-60d, 61-90d, 90+d)',
   'standard', 'bar',
   '{"measures":["invoice_outstanding_usd","invoice_count"],"primaryDimension":"age_bucket"}',
   8),
  ('ai-actions', 'AI Actions',
   'AI recommendation outcomes with status and action filters',
   'standard', 'table',
   '{"measures":["recommendation_count","recommendation_executed_count"],"primaryDimension":"status"}',
   9),
  ('compliance-summary', 'Compliance Summary',
   'Sanctions screening and KYT alert statistics',
   'standard', 'kpi',
   '{"measures":["screening_count","screening_hit_count","kyt_alert_count","kyt_open_count"]}',
   10),
  ('yield-performance', 'Yield Performance',
   'Yield positions and transaction activity by protocol',
   'standard', 'table',
   '{"measures":["yield_deposited_usd","yield_withdrawn_usd"],"primaryDimension":"protocol"}',
   11),
  ('idle-cash', 'Idle Cash Trend',
   'Idle stablecoin balance over time (balance minus confirmed outflows)',
   'standard', 'line',
   '{"measures":["idle_cash_usd","stablecoin_balance_usd"],"primaryDimension":"time","granularity":"day"}',
   12)
ON CONFLICT DO NOTHING;

-- Audit actions
INSERT INTO audit_action_registry (action, description)
VALUES
  ('analytics_view_create', 'Custom analytics view created'),
  ('analytics_view_update', 'Analytics view configuration updated'),
  ('analytics_view_delete', 'Custom analytics view deleted'),
  ('analytics_query', 'Analytics view query executed')
ON CONFLICT (action) DO NOTHING;

-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';
