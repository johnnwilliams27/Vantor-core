import { describe, it, expect } from 'vitest';
import type { ResolverContext } from '@/lib/analytics/types';
import {
  resolveTreasurySummary,
  resolveBalanceHistory,
  resolveIdleCash,
} from '@/lib/analytics/resolvers/treasury';
import { mockSupabase } from './mock-supabase';

function baseCtx(supabase: any): ResolverContext {
  return {
    supabase,
    enterpriseId: 'ent-1',
    from: '2026-04-01',
    to: '2026-04-10',
    filters: {},
    granularity: 'day',
    page: 1,
    pageSize: 25,
  };
}

describe('resolveTreasurySummary', () => {
  it('computes KPI scalars using new-taxonomy leaves', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [
        {
          taken_at: '2026-04-10T12:00:00Z',
          total_value_base_usd: '1000000',
          total_fiat_base_usd: '400000', // legacy mirror of bank
          total_stablecoin_base_usd: '500000',
          total_defi_base_usd: '100000',
          total_bank_base_usd: '400000',
          total_stablecoin_idle_base_usd: '300000',
          total_mmf_base_usd: '50000',
          total_defi_vault_base_usd: '30000',
          total_defi_lending_base_usd: '20000',
          total_other_base_usd: '200000',
        },
      ],
      obligations: [
        { amount_usd: '100000' },
        { amount_usd: '50000' },
      ],
    });

    const result = await resolveTreasurySummary(baseCtx(sb));
    expect(result.view.slug).toBe('treasury-summary');
    expect(result.view.chartType).toBe('kpi');
    expect(result.scalar).toBeDefined();

    const s = result.scalar!;
    // Rollups
    expect(s.total_balance_usd).toBe(1_000_000);
    expect(s.cash_and_equivalents_usd).toBe(700_000); // 400k bank + 300k stable_idle
    expect(s.defi_protocols_usd).toBe(50_000); // 30k vault + 20k lending
    expect(s.yield_positions_usd).toBe(100_000); // 50k mmf + 30k vault + 20k lending
    // Leaves
    expect(s.bank_balance_usd).toBe(400_000);
    expect(s.stablecoin_idle_balance_usd).toBe(300_000);
    expect(s.mmf_balance_usd).toBe(50_000);
    expect(s.defi_vault_balance_usd).toBe(30_000);
    expect(s.defi_lending_balance_usd).toBe(20_000);
    expect(s.other_balance_usd).toBe(200_000);
    // Derived
    expect(s.obligation_total_usd).toBe(150_000);
    expect(s.idle_cash_usd).toBe(550_000); // 700k cash - 150k obligations
    expect(s.coverage_ratio).toBe(4.67); // 700k / 150k
    // Legacy slugs removed in Phase C-1.5b — no longer emitted.
    expect(s.fiat_balance_usd).toBeUndefined();
    expect(s.stablecoin_balance_usd).toBeUndefined();
    expect(s.defi_balance_usd).toBeUndefined();
  });

  it('handles no snapshot', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [],
      obligations: [],
    });
    const result = await resolveTreasurySummary(baseCtx(sb));
    expect(result.scalar!.total_balance_usd).toBe(0);
    expect(result.scalar!.cash_and_equivalents_usd).toBe(0);
    expect(result.scalar!.coverage_ratio).toBe(0);
  });

  it('falls back to legacy fiat column when new leaves are NULL (pre-migration snapshot)', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [
        {
          taken_at: '2026-04-10T12:00:00Z',
          total_value_base_usd: '500000',
          total_fiat_base_usd: '500000',
          total_stablecoin_base_usd: '0',
          total_defi_base_usd: '0',
          // new leaves NULL — pre-migration row
          total_bank_base_usd: null,
          total_stablecoin_idle_base_usd: null,
        },
      ],
      obligations: [{ amount_usd: '100000' }],
    });
    const result = await resolveTreasurySummary(baseCtx(sb));
    // Cash & Equivalents falls back to legacy fiat → 500k
    expect(result.scalar!.cash_and_equivalents_usd).toBe(500_000);
    expect(result.scalar!.coverage_ratio).toBe(5); // 500k / 100k
  });
});

describe('resolveBalanceHistory', () => {
  it('returns rollup + leaf series grouped by day', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [
        {
          taken_at: '2026-04-01T10:00:00Z',
          total_value_base_usd: '350',
          total_fiat_base_usd: '100',
          total_stablecoin_base_usd: '200',
          total_defi_base_usd: '50',
          total_bank_base_usd: '100',
          total_stablecoin_idle_base_usd: '150',
          total_mmf_base_usd: '30',
          total_defi_vault_base_usd: '15',
          total_defi_lending_base_usd: '5',
          total_other_base_usd: '50',
        },
        {
          taken_at: '2026-04-02T10:00:00Z',
          total_value_base_usd: '375',
          total_fiat_base_usd: '110',
          total_stablecoin_base_usd: '210',
          total_defi_base_usd: '55',
          total_bank_base_usd: '110',
          total_stablecoin_idle_base_usd: '160',
          total_mmf_base_usd: '35',
          total_defi_vault_base_usd: '15',
          total_defi_lending_base_usd: '5',
          total_other_base_usd: '50',
        },
      ],
    });

    const result = await resolveBalanceHistory(baseCtx(sb));
    expect(result.view.slug).toBe('balance-history');
    expect(result.view.chartType).toBe('line');
    expect(result.series).toBeDefined();

    expect(result.series!.cash_and_equivalents_usd).toHaveLength(2);
    expect(result.series!.cash_and_equivalents_usd[0]).toEqual({
      date: '2026-04-01',
      value: 250, // 100 + 150
    });
    expect(result.series!.bank_balance_usd[1]).toEqual({ date: '2026-04-02', value: 110 });
    expect(result.series!.mmf_balance_usd[0]).toEqual({ date: '2026-04-01', value: 30 });
    expect(result.series!.yield_positions_usd[0]).toEqual({
      date: '2026-04-01',
      value: 50, // 30 mmf + 15 vault + 5 lending
    });
    // Legacy series removed in Phase C-1.5b.
    expect(result.series!.fiat_balance_usd).toBeUndefined();
    expect(result.series!.stablecoin_balance_usd).toBeUndefined();
    expect(result.series!.defi_balance_usd).toBeUndefined();
  });

  it('handles empty data', async () => {
    const sb = mockSupabase({ treasury_state_snapshots: [] });
    const result = await resolveBalanceHistory(baseCtx(sb));
    expect(result.series!.cash_and_equivalents_usd).toEqual([]);
    expect(result.series!.bank_balance_usd).toEqual([]);
  });
});

describe('resolveIdleCash', () => {
  it('computes idle cash from Cash & Equivalents minus lookahead obligations', async () => {
    const sb = mockSupabase({
      treasury_rules: [{ obligation_lookahead_days: 30 }],
      treasury_state_snapshots: [
        {
          taken_at: '2026-04-01T00:00:00Z',
          total_fiat_base_usd: '0',
          total_bank_base_usd: '300000',
          total_stablecoin_idle_base_usd: '200000',
        },
        {
          taken_at: '2026-04-05T00:00:00Z',
          total_fiat_base_usd: '0',
          total_bank_base_usd: '400000',
          total_stablecoin_idle_base_usd: '200000',
        },
      ],
      obligations: [
        { amount_usd: '100000', due_date: '2026-04-10' },
        { amount_usd: '50000', due_date: '2026-06-01' }, // beyond 30d lookahead
      ],
    });

    const result = await resolveIdleCash(baseCtx(sb));
    expect(result.view.slug).toBe('idle-cash');
    expect(result.series).toBeDefined();
    expect(result.series!.idle_cash_usd).toHaveLength(2);
    // 500k cash - 100k obligation (100k is within 30d; 50k is not)
    expect(result.series!.idle_cash_usd[0].value).toBe(400_000);
    // 600k cash - 100k = 500k
    expect(result.series!.idle_cash_usd[1].value).toBe(500_000);
  });
});
