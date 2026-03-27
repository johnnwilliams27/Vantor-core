-- Remove PYUSD from token_symbol enum
-- First clean up any remaining PYUSD data
DELETE FROM wallet_balances WHERE token = 'PYUSD';
DELETE FROM balance_snapshots WHERE token = 'PYUSD';
DELETE FROM swaps WHERE from_token = 'PYUSD' OR to_token = 'PYUSD';
DELETE FROM fiat_transactions WHERE crypto_token = 'PYUSD';
DELETE FROM payments WHERE token = 'PYUSD';
DELETE FROM invoices WHERE token = 'PYUSD';
DELETE FROM bridge_transfers WHERE token = 'PYUSD';
DELETE FROM transactions WHERE token = 'PYUSD';
DELETE FROM gl_postings WHERE token = 'PYUSD';
DELETE FROM kyt_transfers WHERE token = 'PYUSD';
DELETE FROM yield_positions WHERE underlying_token = 'PYUSD';
DELETE FROM yield_transactions WHERE underlying_token = 'PYUSD';

-- Remove wallets that only existed for PYUSD (Test Ethereum Wallet 2)
DELETE FROM wallets WHERE label = 'Test Ethereum Wallet 2';

-- Rename enum: create new without PYUSD, migrate column, drop old
ALTER TYPE token_symbol RENAME TO token_symbol_old;
CREATE TYPE token_symbol AS ENUM ('USDC', 'USDT');

-- Update all columns that use the enum
ALTER TABLE wallet_balances ALTER COLUMN token TYPE token_symbol USING token::text::token_symbol;
ALTER TABLE swaps ALTER COLUMN from_token TYPE token_symbol USING from_token::text::token_symbol;
ALTER TABLE swaps ALTER COLUMN to_token TYPE token_symbol USING to_token::text::token_symbol;
ALTER TABLE fiat_transactions ALTER COLUMN crypto_token TYPE token_symbol USING crypto_token::text::token_symbol;
ALTER TABLE payments ALTER COLUMN token TYPE token_symbol USING token::text::token_symbol;
ALTER TABLE invoices ALTER COLUMN token TYPE token_symbol USING token::text::token_symbol;
ALTER TABLE bridge_transfers ALTER COLUMN token TYPE token_symbol USING token::text::token_symbol;
ALTER TABLE transactions ALTER COLUMN token TYPE token_symbol USING token::text::token_symbol;
ALTER TABLE balance_snapshots ALTER COLUMN token TYPE token_symbol USING token::text::token_symbol;
ALTER TABLE gl_postings ALTER COLUMN token TYPE token_symbol USING token::text::token_symbol;
ALTER TABLE kyt_transfers ALTER COLUMN token TYPE token_symbol USING token::text::token_symbol;
ALTER TABLE yield_positions ALTER COLUMN underlying_token TYPE token_symbol USING underlying_token::text::token_symbol;
ALTER TABLE yield_transactions ALTER COLUMN underlying_token TYPE token_symbol USING underlying_token::text::token_symbol;

DROP TYPE token_symbol_old;
