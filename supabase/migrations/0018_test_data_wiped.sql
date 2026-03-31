-- 0018_test_data_wiped.sql
-- Add test_data_wiped_at to enterprises for tracking when demo data was cleared on upgrade

ALTER TABLE enterprises
  ADD COLUMN IF NOT EXISTS test_data_wiped_at TIMESTAMPTZ;

COMMENT ON COLUMN enterprises.test_data_wiped_at IS 'Set when Lite demo data is wiped on upgrade to a paid tier';
