-- Add nickname column to bank_accounts
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS nickname TEXT;
