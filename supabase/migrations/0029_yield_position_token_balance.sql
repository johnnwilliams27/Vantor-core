-- 0029_yield_position_token_balance.sql
-- Track yield token balance for on-chain verification and accounting

ALTER TABLE yield_positions
  ADD COLUMN yield_token_balance NUMERIC(36,18) NOT NULL DEFAULT 0;

COMMENT ON COLUMN yield_positions.yield_token_balance IS
  'Number of yield-bearing tokens held (aUSDC, sUSDe, vault shares, etc.)';
COMMENT ON COLUMN yield_positions.deposited_amount IS
  'Net cost basis in underlying token units. Adjusted proportionally on partial withdrawals.';
COMMENT ON COLUMN yield_positions.current_value_usd IS
  'Current USD value from most recent on-chain refresh. Do NOT set during deposit/withdraw.';
COMMENT ON COLUMN yield_positions.accrued_yield_usd IS
  'Computed as current_value_usd - deposited_amount. Updated on refresh only.';
