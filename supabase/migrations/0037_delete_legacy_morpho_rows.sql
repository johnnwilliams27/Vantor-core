-- 0037_delete_legacy_morpho_rows.sql
-- The original 'morpho' enum value (created in 0011_yield_protocols.sql)
-- has been retired in favor of the curator-specific 'morpho_steakhouse'
-- and 'morpho_reservoir' venues. The current test seed only inserts
-- 'morpho_reservoir' rows, but pre-existing test enterprises seeded
-- before that change still hold yield_positions / yield_transactions
-- with protocol = 'morpho'. Those rows surface in the dashboard as
-- "Morpho (legacy)" via the LEGACY_DISPLAY_NAMES fallback in
-- src/lib/yield/venues/display.ts.
--
-- All affected rows are seed dummy data (no real on-chain morpho_blue
-- deposits ever happened against the legacy id), so we delete rather
-- than rewrite them.
--
-- Postgres can't drop the 'morpho' enum value itself, but with no rows
-- referencing it, the LEGACY_DISPLAY_NAMES fallback can be removed
-- from the app code in the same release.

DELETE FROM yield_transactions WHERE protocol = 'morpho';
DELETE FROM yield_positions    WHERE protocol = 'morpho';

-- Also scrub any cached rate rows under the legacy id for consistency
-- with how 0035_delete_drift_cache_rows.sql handled the drift removal.
DELETE FROM yield_rate_cache   WHERE protocol = 'morpho';
