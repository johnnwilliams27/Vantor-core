// src/lib/policy/context-loader/treasury-state.ts

import Big from 'big.js';
import { TreasuryState, TreasuryStateFailure } from '../types/context';
import { AssetCode } from '../types/assets';
import { isValidDecimalString } from '../hard-limit-checker/templates';

/**
 * Row returned by the balances query. Shape matches the existing wallet
 * balance tables in Vantor (adapter lives in Plan 2). Tests supply a
 * mock via DI.
 */
export interface BalanceRow {
  asset: AssetCode;
  venue: string;
  amount: string; // native decimal string
  amount_usd: string; // already canonicalized to USD at write time
}

export interface TreasuryStateDeps {
  fetchBalances: (enterpriseId: string) => Promise<BalanceRow[]>;
}

/**
 * Assets that count toward the "cash equivalent" total used by
 * min_cash_reserve_usd hard limits. Phase-1 list is USD + stablecoins.
 */
const CASH_EQUIVALENT_ASSETS: ReadonlySet<string> = new Set(['USD', 'USDC', 'USDT']);

/**
 * Load treasury state for an enterprise. Assembles per-asset native
 * positions, per-venue native positions, per-asset USD-equivalent
 * positions, and total/cash-equivalent rollups.
 *
 * Never throws. On fetch error or malformed row data, returns a
 * TreasuryState with a populated `failures` array so the caller
 * (context loader → engine) can surface the degradation.
 */
export async function loadTreasuryState(
  enterpriseId: string,
  deps: TreasuryStateDeps,
): Promise<TreasuryState> {
  let rows: BalanceRow[];
  try {
    rows = await deps.fetchBalances(enterpriseId);
  } catch (err) {
    return emptyStateWithFailure({
      reason_code: 'treasury_state_unavailable',
      human_readable: `Failed to load balances: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const failures: TreasuryStateFailure[] = [];
  const positionsByAsset: Record<string, Big> = {};
  const positionsByAssetVenue: Record<string, string> = {};
  const positionsUsdByAsset: Record<string, Big> = {};
  let totalUsd = new Big(0);
  let cashEquivalentUsd = new Big(0);

  for (const row of rows) {
    // Validate decimal strings BEFORE calling big.js so a corrupt row
    // produces a structured failure instead of a raw big.js throw
    // escaping the never-throws contract.
    if (!isValidDecimalString(row.amount) || !isValidDecimalString(row.amount_usd)) {
      failures.push({
        asset: row.asset,
        venue: row.venue,
        reason_code: 'treasury_state_unavailable',
        human_readable: `Malformed balance row for ${row.asset} at ${row.venue}: amount="${row.amount}", amount_usd="${row.amount_usd}"`,
      });
      continue;
    }

    try {
      positionsByAsset[row.asset] = (positionsByAsset[row.asset] ?? new Big(0)).plus(row.amount);
      positionsByAssetVenue[`${row.asset}:${row.venue}`] = row.amount;
      positionsUsdByAsset[row.asset] = (positionsUsdByAsset[row.asset] ?? new Big(0)).plus(
        row.amount_usd,
      );
      totalUsd = totalUsd.plus(row.amount_usd);
      if (CASH_EQUIVALENT_ASSETS.has(row.asset)) {
        cashEquivalentUsd = cashEquivalentUsd.plus(row.amount_usd);
      }
    } catch (err) {
      // Defense in depth — if big.js still throws despite isValidDecimalString,
      // record the failure and continue processing other rows.
      failures.push({
        asset: row.asset,
        venue: row.venue,
        reason_code: 'treasury_state_unavailable',
        human_readable: `big.js arithmetic failed for ${row.asset} at ${row.venue}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    positions_by_asset: Object.fromEntries(
      Object.entries(positionsByAsset).map(([k, v]) => [k, v.toString()]),
    ),
    positions_by_asset_venue: positionsByAssetVenue,
    positions_usd_by_asset: Object.fromEntries(
      Object.entries(positionsUsdByAsset).map(([k, v]) => [k, v.toString()]),
    ),
    total_treasury_usd: totalUsd.toString(),
    cash_equivalent_usd: cashEquivalentUsd.toString(),
    loaded_at: new Date(),
    failures: failures.length > 0 ? failures : undefined,
  };
}

function emptyStateWithFailure(failure: TreasuryStateFailure): TreasuryState {
  return {
    positions_by_asset: {},
    positions_by_asset_venue: {},
    positions_usd_by_asset: {},
    total_treasury_usd: '0',
    cash_equivalent_usd: '0',
    loaded_at: new Date(),
    failures: [failure],
  };
}
