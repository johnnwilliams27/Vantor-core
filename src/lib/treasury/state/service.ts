import type { SupabaseClient } from '@supabase/supabase-js';
import { getStablecoinPrices, priceToken } from '@/lib/treasury/oracle';
import { getFxRate, SUPPORTED_FIAT_CURRENCIES, type FiatCurrency } from '@/lib/fx/rates';
import { computeSegmentationBuckets } from './segmentation';
import type {
  BankAccountPosition,
  DefiPosition,
  PendingTransfer,
  SnapshotTrigger,
  TreasuryPositions,
  TreasuryStateSnapshot,
  WalletPosition,
} from './types';

function isSupportedFiat(c: string): c is FiatCurrency {
  return (SUPPORTED_FIAT_CURRENCIES as readonly string[]).includes(c);
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Computes and persists point-in-time treasury state snapshots.
 *
 * Aggregates bank accounts, wallet balances, DeFi positions, and
 * in-flight transfers into a single normalized view used by the
 * ForecastEngine (T10) and the rules engine.
 *
 * FX rates and stablecoin prices are captured at snapshot time so
 * any forecast derived from the snapshot is reproducible.
 */
export class TreasuryStateService {
  constructor(private db: SupabaseClient) {}

  async computeSnapshot(
    enterpriseId: string,
    trigger: SnapshotTrigger,
  ): Promise<Omit<TreasuryStateSnapshot, 'id' | 'takenAt'>> {
    const [
      bankRes,
      walletRes,
      yieldRes,
      pendingTransfers,
      pendingBridges,
      pendingFiat,
      pendingYieldTx,
    ] = await Promise.all([
      this.db
        .from('bank_accounts')
        .select(
          'id, institution_name, account_name, last4, currency, current_balance, balance_as_of',
        )
        .eq('enterprise_id', enterpriseId)
        .eq('is_active', true),
      this.db
        .from('wallet_balances')
        .select(
          'wallet_id, balance, usd_value, token, last_updated, wallets!inner(chain, enterprise_id)',
        )
        .eq('wallets.enterprise_id', enterpriseId),
      this.db
        .from('yield_positions')
        .select(
          'id, protocol, chain, underlying_token, deposited_amount, current_value_usd, accrued_yield_usd, apy_snapshot, last_refreshed_at',
        )
        .eq('enterprise_id', enterpriseId)
        .eq('is_active', true),
      this.db
        .from('transfers')
        .select('id, amount, token, status, scheduled_for, from_wallet_id, to_address')
        .eq('enterprise_id', enterpriseId)
        .in('status', ['pending', 'processing']),
      this.db
        .from('bridge_transfers')
        .select(
          'id, amount, token, status, from_chain, to_chain, estimated_arrival_minutes',
        )
        .eq('enterprise_id', enterpriseId)
        .in('status', ['pending', 'processing']),
      this.db
        .from('fiat_payments')
        .select('id, amount, currency, status, scheduled_for, estimated_settlement')
        .eq('enterprise_id', enterpriseId)
        .in('status', ['pending', 'processing']),
      this.db
        .from('yield_transactions')
        .select('id, amount, amount_usd, tx_type, status')
        .eq('enterprise_id', enterpriseId)
        .in('status', ['pending', 'processing']),
    ]);

    // FX rates captured for reproducibility — USD reference is implicit.
    const fxRates: Record<string, number> = { USD: 1 };

    const bankAccounts: BankAccountPosition[] = [];
    for (const r of (bankRes.data ?? []) as Array<Record<string, unknown>>) {
      const balanceNative = num(r.current_balance);
      const currency = String(r.currency ?? 'USD');
      let rate = 1;
      if (currency !== 'USD' && isSupportedFiat(currency)) {
        rate = getFxRate(currency, 'USD');
        fxRates[`${currency}->USD`] = rate;
      }
      bankAccounts.push({
        accountId: String(r.id),
        institutionName: String(r.institution_name ?? ''),
        accountName: String(r.account_name ?? ''),
        last4: (r.last4 as string | null) ?? null,
        currency,
        balanceNative,
        balanceBaseUsd: balanceNative * rate,
        balanceAsOf: (r.balance_as_of as string | null) ?? null,
      });
    }

    // Stablecoin prices fetched once per snapshot, not per-wallet.
    const stablecoinPrices =
      (walletRes.data?.length ?? 0) > 0
        ? (await getStablecoinPrices()).prices
        : null;

    const wallets: WalletPosition[] = [];
    for (const r of (walletRes.data ?? []) as Array<Record<string, unknown>>) {
      const balanceNative = num(r.balance);
      let baseUsd = num(r.usd_value);
      if (baseUsd === 0 && balanceNative > 0 && stablecoinPrices) {
        baseUsd = priceToken(String(r.token ?? ''), balanceNative, stablecoinPrices);
      }
      const walletsJoin = r.wallets as { chain?: string } | null;
      wallets.push({
        walletId: String(r.wallet_id),
        chain: walletsJoin?.chain ?? 'unknown',
        token: String(r.token ?? ''),
        balanceNative,
        balanceBaseUsd: baseUsd,
        lastUpdated: (r.last_updated as string | null) ?? null,
      });
    }

    const defiPositions: DefiPosition[] = (
      (yieldRes.data ?? []) as Array<Record<string, unknown>>
    ).map((r) => ({
      positionId: String(r.id),
      protocol: String(r.protocol ?? ''),
      chain: String(r.chain ?? ''),
      underlyingToken: String(r.underlying_token ?? ''),
      depositedAmount: num(r.deposited_amount),
      currentValueBaseUsd: num(r.current_value_usd),
      accruedYieldBaseUsd: num(r.accrued_yield_usd),
      apySnapshot: r.apy_snapshot != null ? num(r.apy_snapshot) : null,
      lastRefreshedAt: (r.last_refreshed_at as string | null) ?? null,
    }));

    const pending: PendingTransfer[] = [
      ...((pendingTransfers.data ?? []) as Array<Record<string, unknown>>).map(
        (r): PendingTransfer => ({
          id: String(r.id),
          kind: 'transfer',
          amount: num(r.amount),
          asset: String(r.token ?? ''),
          fromVenue: (r.from_wallet_id as string | null) ?? null,
          toVenue: (r.to_address as string | null) ?? null,
          expectedSettleAt: (r.scheduled_for as string | null) ?? null,
        }),
      ),
      ...((pendingBridges.data ?? []) as Array<Record<string, unknown>>).map(
        (r): PendingTransfer => {
          const mins = r.estimated_arrival_minutes;
          return {
            id: String(r.id),
            kind: 'bridge_transfer',
            amount: num(r.amount),
            asset: String(r.token ?? ''),
            fromVenue: (r.from_chain as string | null) ?? null,
            toVenue: (r.to_chain as string | null) ?? null,
            expectedSettleAt:
              typeof mins === 'number' && mins > 0
                ? new Date(Date.now() + mins * 60 * 1000).toISOString()
                : null,
          };
        },
      ),
      ...((pendingFiat.data ?? []) as Array<Record<string, unknown>>).map(
        (r): PendingTransfer => ({
          id: String(r.id),
          kind: 'fiat_payment',
          amount: num(r.amount),
          asset: String(r.currency ?? 'USD'),
          fromVenue: null,
          toVenue: null,
          expectedSettleAt:
            (r.estimated_settlement as string | null) ??
            (r.scheduled_for as string | null) ??
            null,
        }),
      ),
      ...((pendingYieldTx.data ?? []) as Array<Record<string, unknown>>).map(
        (r): PendingTransfer => ({
          id: String(r.id),
          kind: 'yield_transaction',
          amount: num(r.amount_usd ?? r.amount),
          asset: 'USD',
          fromVenue: null,
          toVenue: null,
          expectedSettleAt: null,
        }),
      ),
    ];

    const positions: TreasuryPositions = {
      bankAccounts,
      wallets,
      defiPositions,
      pendingTransfers: pending,
    };

    const buckets = computeSegmentationBuckets({ bankAccounts, wallets, defiPositions });

    // Invariant — new-leaf sum must equal legacy sum. If this diverges, a
    // new venue category was added to the registry but not to the
    // taxonomy in holdings-category.ts.
    if (process.env.NODE_ENV !== 'production') {
      const legacySum =
        buckets.totalFiatBaseUsd + buckets.totalStablecoinBaseUsd + buckets.totalDefiBaseUsd;
      if (Math.abs(buckets.totalValueBaseUsd - legacySum) > 0.01) {
        console.warn(
          `[TreasuryStateService] Taxonomy drift: new=${buckets.totalValueBaseUsd}, legacy=${legacySum} for enterprise ${enterpriseId}`,
        );
      }
    }

    return {
      enterpriseId,
      takenBy: null,
      trigger,
      baseCurrency: 'USD',
      totalValueBaseUsd: buckets.totalValueBaseUsd,
      totalFiatBaseUsd: buckets.totalFiatBaseUsd,
      totalStablecoinBaseUsd: buckets.totalStablecoinBaseUsd,
      totalDefiBaseUsd: buckets.totalDefiBaseUsd,
      totalBankBaseUsd: buckets.totalBankBaseUsd,
      totalStablecoinIdleBaseUsd: buckets.totalStablecoinIdleBaseUsd,
      totalMmfBaseUsd: buckets.totalMmfBaseUsd,
      totalDefiVaultBaseUsd: buckets.totalDefiVaultBaseUsd,
      totalDefiLendingBaseUsd: buckets.totalDefiLendingBaseUsd,
      totalOtherBaseUsd: buckets.totalOtherBaseUsd,
      positions,
      fxRates,
    };
  }

  async persistSnapshot(
    snap: Omit<TreasuryStateSnapshot, 'id' | 'takenAt'>,
    takenBy: string | null,
  ): Promise<TreasuryStateSnapshot> {
    const { data, error } = await this.db
      .from('treasury_state_snapshots')
      .insert({
        enterprise_id: snap.enterpriseId,
        taken_by: takenBy,
        trigger: snap.trigger,
        base_currency: snap.baseCurrency,
        total_value_base_usd: snap.totalValueBaseUsd,
        total_fiat_base_usd: snap.totalFiatBaseUsd,
        total_stablecoin_base_usd: snap.totalStablecoinBaseUsd,
        total_defi_base_usd: snap.totalDefiBaseUsd,
        total_bank_base_usd: snap.totalBankBaseUsd,
        total_stablecoin_idle_base_usd: snap.totalStablecoinIdleBaseUsd,
        total_mmf_base_usd: snap.totalMmfBaseUsd,
        total_defi_vault_base_usd: snap.totalDefiVaultBaseUsd,
        total_defi_lending_base_usd: snap.totalDefiLendingBaseUsd,
        total_other_base_usd: snap.totalOtherBaseUsd,
        positions: snap.positions,
        fx_rates: snap.fxRates,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new Error(`Snapshot persist failed: ${error?.message ?? 'no row returned'}`);
    }
    return {
      ...snap,
      id: data.id as string,
      takenAt: data.taken_at as string,
      takenBy,
    };
  }

  async latest(enterpriseId: string): Promise<TreasuryStateSnapshot | null> {
    const { data, error } = await this.db
      .from('treasury_state_snapshots')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id as string,
      enterpriseId: data.enterprise_id as string,
      takenAt: data.taken_at as string,
      takenBy: (data.taken_by as string | null) ?? null,
      trigger: data.trigger as SnapshotTrigger,
      baseCurrency: data.base_currency as string,
      totalValueBaseUsd: num(data.total_value_base_usd),
      totalFiatBaseUsd: num(data.total_fiat_base_usd),
      totalStablecoinBaseUsd: num(data.total_stablecoin_base_usd),
      totalDefiBaseUsd: num(data.total_defi_base_usd),
      totalBankBaseUsd: num(data.total_bank_base_usd),
      totalStablecoinIdleBaseUsd: num(data.total_stablecoin_idle_base_usd),
      totalMmfBaseUsd: num(data.total_mmf_base_usd),
      totalDefiVaultBaseUsd: num(data.total_defi_vault_base_usd),
      totalDefiLendingBaseUsd: num(data.total_defi_lending_base_usd),
      totalOtherBaseUsd: num(data.total_other_base_usd),
      positions: data.positions as TreasuryPositions,
      fxRates: (data.fx_rates as Record<string, number>) ?? {},
    };
  }
}
