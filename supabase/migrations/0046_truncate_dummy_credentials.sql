-- 0046_truncate_dummy_credentials.sql
-- Empties dummy-data rows from erp_configurations and slack_integrations
-- as part of the switch from base64 passthrough to real AES-256-GCM.
--
-- SAFETY: this is destructive. The engineer applying this migration runs
-- a SELECT COUNT(*) in BOTH tables, in BOTH dev and prod, before applying
-- it. If either table contains more than a trivial number of rows, STOP
-- and investigate — the base64-encoded credentials cannot be decrypted by
-- the new code, so they must be re-entered by the user anyway, but you
-- must confirm with the product owner that losing them is acceptable.

TRUNCATE TABLE erp_configurations CASCADE;
TRUNCATE TABLE slack_integrations CASCADE;
