-- 0007_extend_erp_providers.sql
-- Adds 'xero' and 'netsuite' values to the erp_provider enum

ALTER TYPE erp_provider ADD VALUE IF NOT EXISTS 'xero';
ALTER TYPE erp_provider ADD VALUE IF NOT EXISTS 'netsuite';
