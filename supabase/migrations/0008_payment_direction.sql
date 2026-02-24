-- 0008_payment_direction.sql
-- Adds bi-directional support to the payments table.
-- 'sent'     = user's wallet → external address  (existing behaviour)
-- 'received' = external address → user's wallet  (new)

-- Add direction enum
CREATE TYPE payment_direction AS ENUM ('sent', 'received');

-- Add direction column — backfill all existing rows as 'sent'
ALTER TABLE payments
  ADD COLUMN direction payment_direction NOT NULL DEFAULT 'sent';

-- Add from_address for received payments (the external sender)
-- For sent payments this stays NULL; from_wallet_id carries the source.
ALTER TABLE payments
  ADD COLUMN from_address TEXT;

-- Make from_wallet_id nullable:
-- sent     → from_wallet_id = user's wallet UUID, from_address = NULL
-- received → from_wallet_id = NULL,                from_address = sender's address
ALTER TABLE payments
  ALTER COLUMN from_wallet_id DROP NOT NULL;
