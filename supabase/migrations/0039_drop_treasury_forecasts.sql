-- ============================================================
-- 0039_drop_treasury_forecasts.sql — hard cut the legacy
-- treasury_forecasts table.
--
-- DO NOT APPLY until Tasks 15, 16, and 17 of Phase A have landed:
-- they're the last readers of the legacy table, and cutover is
-- what lets this drop be safe. Apply in Task 20 after the final
-- rewrite commits are in place.
-- ============================================================
--
-- History:
--   0006_treasury_phase2.sql — created treasury_forecasts
--   0010_multi_tenancy.sql   — added enterprise_id column + RLS
--
-- Replaced by forecast_snapshots (0038) from Phase A, which
-- captures the same projection data plus scenario params, a
-- correlation_id for audit linkage, and a FK back to the
-- underlying treasury_state_snapshot (0037) it was computed from.

DROP TABLE IF EXISTS treasury_forecasts CASCADE;
