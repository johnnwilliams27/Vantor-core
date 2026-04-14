// src/lib/test-mode/seed/yield.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash, solHash } from './helpers';
import type { WalletIds } from './wallets';

/**
 * Seed data for the test-mode enterprise. Mix of:
 *
 *   1. DeFi yield positions (Aave V3, Morpho, Kamino, Ondo USDY) — land
 *      in the DeFi Positions card after the venue-categories restructure.
 *   2. Tokenized MMF positions (Spiko USD, Circle USYC, Ondo OUSG) — land
 *      in the Cash & Cash Equivalents card because tokenized MMFs are
 *      cash-class in the treasurer's mental model.
 *
 * All rows carry metadata.mock = true so the existing is-demo detection
 * (via metadata flag + enterprise.is_test_enterprise) picks them up.
 *
 * The MMFs reference the 'coming_soon' venues in the registry. That's
 * intentional — demo holdings exist independently of live status so
 * the Cash card has realistic content to display before any integration
 * actually ships.
 */
export async function seedYield(ctx: SeedContext, walletIds: WalletIds): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  // ─── DeFi yield positions (existing seed, preserved) ──────────
  const defiPositions = [
    { protocol: 'aave_v3',          chain: 'ethereum', token: 'USDC', yieldToken: 'aUSDC',             deposited: 250_000, apy: 4.8, wallets: walletIds.ethWallets },
    { protocol: 'morpho_reservoir', chain: 'ethereum', token: 'USDC', yieldToken: 'bbqUSDCreservoir',  deposited: 150_000, apy: 7.0, wallets: walletIds.ethWallets },
    { protocol: 'kamino',           chain: 'solana',   token: 'USDC', yieldToken: 'kUSDC',             deposited: 100_000, apy: 6.1, wallets: walletIds.solWallets },
    // Ondo USDY — note: receipt token is USDY, not OUSG. OUSG is a
    // separate product (now its own tokenized_mmf venue below).
    { protocol: 'ondo_usdy',        chain: 'ethereum', token: 'USDC', yieldToken: 'USDY',              deposited: 500_000, apy: 4.5, wallets: walletIds.ethWallets },
  ];

  // ─── Tokenized MMF demo positions (new) ───────────────────────
  // Yields match VENUES registry reference values (as of 2026-04-11).
  // Created_at dates are staggered across ~6 weeks so the positions
  // look like organic growth, not a single seed batch.
  const mmfPositions = [
    {
      protocol: 'spiko_usd', chain: 'ethereum', token: 'USDC',
      yieldToken: 'USTBL',  deposited: 250_000, apy: 4.05,
      daysAgoOverride: 45,
      wallets: walletIds.ethWallets,
    },
    {
      protocol: 'usyc',      chain: 'ethereum', token: 'USDC',
      yieldToken: 'USYC',    deposited: 400_000, apy: 3.18,
      daysAgoOverride: 28,
      wallets: walletIds.ethWallets,
    },
    {
      protocol: 'ousg',      chain: 'ethereum', token: 'USDC',
      yieldToken: 'OUSG',    deposited: 750_000, apy: 3.37,
      daysAgoOverride: 14,
      wallets: walletIds.ethWallets,
    },
  ];

  type SeedPosition = {
    protocol: string;
    chain: string;
    token: string;
    yieldToken: string;
    deposited: number;
    apy: number;
    wallets: Array<{ id: string }>;
    daysAgoOverride?: number;
  };

  const allPositions: SeedPosition[] = [...defiPositions, ...mmfPositions];

  for (const pos of allPositions) {
    if (!pos.wallets.length) continue;
    const wallet = pick(pos.wallets);
    const daysActive = pos.daysAgoOverride ?? randInt(30, 120);
    const accrued = (pos.deposited * (pos.apy / 100) * (daysActive / 365)).toFixed(2);
    const currentValue = (pos.deposited + parseFloat(accrued)).toFixed(2);

    const { data: position, error: posErr } = await supabase
      .from('yield_positions')
      .insert({
        user_id: userId, enterprise_id: enterpriseId, wallet_id: wallet.id,
        protocol: pos.protocol, chain: pos.chain, underlying_token: pos.token,
        yield_token: pos.yieldToken, deposited_amount: pos.deposited.toFixed(2),
        current_value_usd: currentValue, accrued_yield_usd: accrued,
        apy_snapshot: pos.apy, last_refreshed_at: new Date().toISOString(),
        is_active: true, metadata: { mock: true }, created_at: daysAgo(daysActive),
      })
      .select('id')
      .single();
    if (posErr) throw new Error(`seedYield: yield_positions insert failed: ${posErr.message}`);
    if (!position) continue;

    const isEth = pos.chain === 'ethereum';
    {
      const { error } = await supabase.from('yield_transactions').insert({
        user_id: userId, enterprise_id: enterpriseId, position_id: position.id,
        protocol: pos.protocol, chain: pos.chain, tx_type: 'deposit',
        underlying_token: pos.token, amount: pos.deposited.toFixed(2),
        amount_usd: pos.deposited.toFixed(2), tx_hash: isEth ? ethHash() : solHash(),
        status: 'completed', executed_at: daysAgo(daysActive), created_at: daysAgo(daysActive),
      });
      if (error) throw new Error(`seedYield: yield_transactions deposit insert failed: ${error.message}`);
    }

    // Only the DeFi positions get random withdrawals. MMF demo positions
    // are pristine — they represent a "fresh from integration" story.
    if (!pos.daysAgoOverride && Math.random() > 0.5) {
      const withdrawAmount = rand(10_000, pos.deposited * 0.3).toFixed(2);
      const { error } = await supabase.from('yield_transactions').insert({
        user_id: userId, enterprise_id: enterpriseId, position_id: position.id,
        protocol: pos.protocol, chain: pos.chain, tx_type: 'withdraw',
        underlying_token: pos.token, amount: withdrawAmount, amount_usd: withdrawAmount,
        tx_hash: isEth ? ethHash() : solHash(), status: 'completed',
        executed_at: daysAgo(randInt(5, daysActive - 5)), created_at: daysAgo(randInt(5, daysActive - 5)),
      });
      if (error) throw new Error(`seedYield: yield_transactions withdraw insert failed: ${error.message}`);
    }
  }
}
