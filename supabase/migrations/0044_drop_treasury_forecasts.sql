-- ============================================================
-- 0044_drop_treasury_forecasts.sql — hard cut the legacy
-- treasury_forecasts table.
--
-- Was 0039 on the forecast-analytics branch; renumbered to 0044
-- when the branch merged master and the 0036/0037 filename slots
-- turned out to be taken by venue_categories and
-- delete_legacy_morpho_rows.
-- ============================================================
--
-- History:
--   0006_treasury_phase2.sql — created treasury_forecasts
--   0010_multi_tenancy.sql   — added enterprise_id column + RLS
--
-- Replaced by forecast_snapshots (0043) from Phase A, which
-- captures the same projection data plus scenario params, a
-- correlation_id for audit linkage, and a FK back to the
-- underlying treasury_state_snapshot (0042) it was computed from.

DROP TABLE IF EXISTS treasury_forecasts CASCADE;
