-- 0035_delete_drift_cache_rows.sql
-- Drift was removed from the platform entirely. Clear stale yield_rate_cache
-- rows so the DbLiquidityProvider and /api/yield/rates don't keep returning
-- them. Also removes any yield_positions that were (unlikely) opened against
-- Drift — Drift was "Coming Soon" so no real deposits should exist.

DELETE FROM yield_rate_cache WHERE protocol = 'drift';

-- Defensive cleanup — these two tables reference protocol by string.
-- The app-level COMING_SOON gate should have prevented any real rows,
-- but in case a seed script or test ever wrote any, scrub them.
DELETE FROM yield_positions WHERE protocol = 'drift';
DELETE FROM yield_transactions WHERE protocol = 'drift';
