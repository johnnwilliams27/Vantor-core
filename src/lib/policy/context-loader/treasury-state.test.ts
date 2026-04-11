import { describe, it, expect, vi } from 'vitest';
import { loadTreasuryState, BalanceRow } from './treasury-state';

describe('loadTreasuryState', () => {
  it('assembles balances into TreasuryState shape', async () => {
    const fetchBalances = vi.fn().mockResolvedValue([
      { asset: 'USDC', venue: 'ethereum', amount: '800000', amount_usd: '800000' },
      { asset: 'USDC', venue: 'solana', amount: '200000', amount_usd: '200000' },
      { asset: 'USDT', venue: 'ethereum', amount: '500000', amount_usd: '500000' },
    ] as BalanceRow[]);

    const state = await loadTreasuryState('ent-1', { fetchBalances });

    expect(state.positions_by_asset).toEqual({ USDC: '1000000', USDT: '500000' });
    expect(state.positions_by_asset_venue).toEqual({
      'USDC:ethereum': '800000',
      'USDC:solana': '200000',
      'USDT:ethereum': '500000',
    });
    expect(state.total_treasury_usd).toBe('1500000');
    expect(state.cash_equivalent_usd).toBe('1500000');
    expect(state.failures).toBeUndefined();
  });

  it('records a failure when the fetch throws', async () => {
    const fetchBalances = vi.fn().mockRejectedValue(new Error('db down'));
    const state = await loadTreasuryState('ent-1', { fetchBalances });

    expect(state.failures).toBeDefined();
    expect(state.failures?.[0].reason_code).toBe('treasury_state_unavailable');
    expect(state.failures?.[0].human_readable).toContain('db down');
    expect(state.total_treasury_usd).toBe('0');
  });

  it('skips malformed rows and records per-row failures without poisoning the totals', async () => {
    const fetchBalances = vi.fn().mockResolvedValue([
      { asset: 'USDC', venue: 'ethereum', amount: '800000', amount_usd: '800000' },
      { asset: 'USDT', venue: 'ethereum', amount: 'garbage', amount_usd: '500000' },
      { asset: 'USDC', venue: 'solana', amount: '200000', amount_usd: '200000' },
    ] as BalanceRow[]);

    const state = await loadTreasuryState('ent-1', { fetchBalances });

    // Malformed row skipped; valid rows still summed
    expect(state.positions_by_asset).toEqual({ USDC: '1000000' });
    expect(state.total_treasury_usd).toBe('1000000');
    expect(state.failures).toBeDefined();
    expect(state.failures).toHaveLength(1);
    expect(state.failures?.[0].asset).toBe('USDT');
    expect(state.failures?.[0].venue).toBe('ethereum');
  });

  it('rejects negative amounts as malformed (phase-1 invariant: positions are non-negative)', async () => {
    const fetchBalances = vi.fn().mockResolvedValue([
      { asset: 'USDC', venue: 'ethereum', amount: '-100', amount_usd: '-100' },
    ] as BalanceRow[]);

    const state = await loadTreasuryState('ent-1', { fetchBalances });

    expect(state.failures).toHaveLength(1);
    expect(state.positions_by_asset).toEqual({});
  });

  it('computes cash_equivalent_usd from USD+stablecoin positions only', async () => {
    const fetchBalances = vi.fn().mockResolvedValue([
      { asset: 'USDC', venue: 'ethereum', amount: '800000', amount_usd: '800000' },
      { asset: 'USDT', venue: 'ethereum', amount: '200000', amount_usd: '200000' },
      // A non-stablecoin row with a truthy amount_usd — should be in total
      // but NOT in cash_equivalent. Using a schema-bypassed asset to simulate
      // a future asset expansion that isn't yet in CASH_EQUIVALENT_ASSETS.
      { asset: 'BTC' as unknown as 'USDC', venue: 'ethereum', amount: '1', amount_usd: '50000' },
    ] as BalanceRow[]);

    const state = await loadTreasuryState('ent-1', { fetchBalances });

    // total includes all
    expect(state.total_treasury_usd).toBe('1050000');
    // cash equivalent excludes BTC
    expect(state.cash_equivalent_usd).toBe('1000000');
  });

  it('handles empty balance list', async () => {
    const fetchBalances = vi.fn().mockResolvedValue([]);
    const state = await loadTreasuryState('ent-1', { fetchBalances });

    expect(state.positions_by_asset).toEqual({});
    expect(state.total_treasury_usd).toBe('0');
    expect(state.cash_equivalent_usd).toBe('0');
    expect(state.failures).toBeUndefined();
  });
});
