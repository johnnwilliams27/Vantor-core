import type { SeedContext } from './helpers';
import { rand } from './helpers';

export async function seedAnalytics(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  // ─── Part 1: 75 daily treasury_state_snapshots ───────────────────────
  // Anchor: the current aggregate of seeded balances. A fixed anchor with a
  // small random walk is sufficient for demo chart data.
  const currentTotalUsd = 3_200_000;
  const currentFiatUsd = 450_000;
  const currentStableUsd = 2_000_000;
  const currentDefiUsd = 750_000;

  const snapshotRows = [];
  let total = currentTotalUsd;
  let fiat = currentFiatUsd;
  let stable = currentStableUsd;
  let defi = currentDefiUsd;

  for (let d = 0; d < 75; d++) {
    const takenAt = new Date(Date.now() - d * 86_400_000).toISOString();
    const drift = rand(-0.02, 0.02);
    total = Math.max(total * (1 + drift), 1_500_000);
    fiat = Math.max(fiat * (1 + rand(-0.03, 0.03)), 200_000);
    stable = Math.max(stable * (1 + rand(-0.02, 0.02)), 1_000_000);
    defi = Math.max(defi * (1 + rand(-0.03, 0.03)), 300_000);

    snapshotRows.push({
      enterprise_id: enterpriseId,
      taken_at: takenAt,
      taken_by: userId,
      trigger: 'scheduled',
      base_currency: 'USD',
      total_value_base_usd: total.toFixed(2),
      total_fiat_base_usd: fiat.toFixed(2),
      total_stablecoin_base_usd: stable.toFixed(2),
      total_defi_base_usd: defi.toFixed(2),
      positions: [
        { assetSymbol: 'USDC', chain: 'ethereum', venueKind: 'wallet', amount: stable * 0.7, unitPriceUsd: 1, valueUsd: stable * 0.7 },
        { assetSymbol: 'USDT', chain: 'ethereum', venueKind: 'wallet', amount: stable * 0.3, unitPriceUsd: 1, valueUsd: stable * 0.3 },
      ],
      fx_rates: { 'USD/EUR': 0.92, 'USD/GBP': 0.79 },
    });
  }

  // Insert in chunks of 25 to respect Supabase row limits
  for (let i = 0; i < snapshotRows.length; i += 25) {
    const chunk = snapshotRows.slice(i, i + 25);
    const { error } = await supabase.from('treasury_state_snapshots').insert(chunk);
    if (error) { console.error('[seed:analytics] snapshot chunk failed', error); break; }
  }

  // ─── Part 2: analytics_pin_preferences — 3 pinned slugs ───────────────
  // Slugs match entries in src/lib/analytics/standard-views.ts
  const pinnedSlugs = [
    'obligation-coverage',
    'yield-performance',
    'balance-history',
  ];
  const { error: pinErr } = await supabase.from('analytics_pin_preferences').insert({
    user_id: userId,
    enterprise_id: enterpriseId,
    pinned_slugs: pinnedSlugs,
  });
  if (pinErr) console.error('[seed:analytics] pin preferences failed', pinErr);

  console.log('[seed:analytics] ✓ 75 snapshots + 3 pinned views');
}
