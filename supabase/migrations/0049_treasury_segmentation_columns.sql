-- ============================================================
-- 0049_treasury_segmentation_columns.sql
-- Add UX-aligned L3-leaf aggregate columns to treasury_state_snapshots.
--
-- Canonical Vantor treasury taxonomy:
--
--   Total Treasury
--   ├── Cash & Equivalents (L1 — rollup)
--   │   ├── Cash — bank balances, multi-currency        → total_bank_base_usd
--   │   └── Stablecoins — idle USDC/USDT in wallets     → total_stablecoin_idle_base_usd
--   └── Yield Positions (L1 — rollup)
--       ├── Tokenized MMFs — Spiko, BUIDL, USYC, …      → total_mmf_base_usd
--       └── DeFi Protocols (L2 — rollup)
--           ├── DeFi Vaults — Kamino, Morpho, …         → total_defi_vault_base_usd
--           └── DeFi Lending — Aave, Compound, …        → total_defi_lending_base_usd
--   (Other — ETH/SOL/misc + unknown venues)             → total_other_base_usd
--
-- Rollups (Cash & Equivalents, DeFi Protocols, Yield Positions) are computed
-- at read time in the analytics resolver — never stored, so no drift risk.
--
-- The legacy columns (total_fiat_base_usd, total_stablecoin_base_usd,
-- total_defi_base_usd) stay in place during this migration window. Consumers
-- migrate one-by-one in Phase C-1.5b, then a follow-up migration drops them.
-- ============================================================

ALTER TABLE treasury_state_snapshots
  ADD COLUMN IF NOT EXISTS total_bank_base_usd             NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_stablecoin_idle_base_usd  NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_mmf_base_usd              NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_defi_vault_base_usd       NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_defi_lending_base_usd     NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_other_base_usd            NUMERIC(36,2);

COMMENT ON COLUMN treasury_state_snapshots.total_bank_base_usd            IS 'L3 leaf: bank account balances (off-chain, multi-currency converted to USD base). Rolls up into Cash & Equivalents.';
COMMENT ON COLUMN treasury_state_snapshots.total_stablecoin_idle_base_usd IS 'L3 leaf: idle USDC/USDT in self-custody wallets (NOT deployed). Rolls up into Cash & Equivalents.';
COMMENT ON COLUMN treasury_state_snapshots.total_mmf_base_usd             IS 'L3 leaf: tokenized money-market-fund positions (Spiko, BUIDL, USYC, Ondo USDY, etc.). Rolls up into Yield Positions.';
COMMENT ON COLUMN treasury_state_snapshots.total_defi_vault_base_usd      IS 'L3 leaf: DeFi vault protocol positions (Kamino Multiply, Morpho Reservoir, Morpho Steakhouse, etc.). Rolls up into DeFi Protocols → Yield Positions.';
COMMENT ON COLUMN treasury_state_snapshots.total_defi_lending_base_usd    IS 'L3 leaf: DeFi lending protocol positions (Aave V3, Compound V3, Kamino Lend). Rolls up into DeFi Protocols → Yield Positions.';
COMMENT ON COLUMN treasury_state_snapshots.total_other_base_usd           IS 'Fallback: non-stable wallet tokens (ETH/SOL/etc) and unknown yield venues.';

NOTIFY pgrst, 'reload schema';
