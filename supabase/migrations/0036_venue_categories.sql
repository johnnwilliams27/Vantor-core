-- 0036_venue_categories.sql
-- Introduces tokenized money market funds as a new yield venue category
-- and fixes two latent enum gaps.
--
-- Postgres can't safely DELETE enum values, so every touch here is
-- either ADD VALUE IF NOT EXISTS or RENAME VALUE (both of which are
-- cheap, atomic, and preserve referential integrity).

-- ---------------------------------------------------------------------------
-- 1. Rename ondo → ondo_usdy
--
-- The current 'ondo' label is ambiguous: Ondo Finance offers multiple products
-- (USDY as a retail yieldcoin, OUSG as a QP-gated tokenized Treasury MMF).
-- All existing code and data under 'ondo' refers specifically to USDY, so we
-- rename in place. ALTER TYPE ... RENAME VALUE atomically updates the label
-- on the enum type and all existing rows referencing it — no data rewrite.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'yield_protocol_id')
      AND enumlabel = 'ondo'
  ) THEN
    ALTER TYPE yield_protocol_id RENAME VALUE 'ondo' TO 'ondo_usdy';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill two protocol IDs that the TS types claim exist but the DB
--    enum was missing. Without these, yield_positions inserts for Compound V3
--    or Morpho Reservoir would fail with an enum violation — no one noticed
--    because real deposits haven't been wired for those protocols yet, but
--    the mismatch is a footgun we should close before adding more values.
-- ---------------------------------------------------------------------------
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'compound_v3';
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'morpho_reservoir';

-- ---------------------------------------------------------------------------
-- 3. Tokenized money market fund venue IDs
--
-- Each of these corresponds to a regulated tokenized Treasury product. They
-- ship as 'coming_soon' in the application layer — no live mint/redeem
-- integration exists yet — but we seed them here so that demo holdings
-- (Spiko USD, Circle USYC, Ondo OUSG) can reference them by protocol ID
-- without tripping the FK.
-- ---------------------------------------------------------------------------
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'buidl';       -- BlackRock BUIDL
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'ousg';        -- Ondo OUSG
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'ustb';        -- Superstate USTB
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'benji';       -- Franklin Templeton BENJI
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'usyc';        -- Circle USYC
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'spiko_usd';   -- Spiko USD (USTBL)

-- Reload PostgREST schema so the new enum values are visible to the API.
NOTIFY pgrst, 'reload schema';
