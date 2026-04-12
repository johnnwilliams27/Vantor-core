-- 0046_add_quickbooks_erp_provider.sql
-- Adds 'quickbooks' to the erp_provider enum so the ERP settings page can
-- list QuickBooks alongside SAP / Oracle / NetSuite / Xero.

ALTER TYPE erp_provider ADD VALUE IF NOT EXISTS 'quickbooks';
