import { createAdminClient } from '@/lib/supabase/admin';
import { TierSlug, TIERS, isPaidTier } from './tiers';

/** Can this tier access live mode? */
export function canAccessLiveMode(tier: TierSlug): boolean {
  return TIERS[tier].liveMode;
}

/** Get the asset cap in USD for a tier (null = unlimited) */
export function getAssetCap(tier: TierSlug): number | null {
  return TIERS[tier].assetCapUsd;
}

/** Calculate total connected live assets for an enterprise */
export async function getTotalLiveAssets(enterpriseId: string): Promise<number> {
  const supabase = createAdminClient();

  // Sum wallet balances (USD value)
  const { data: walletBalances } = await supabase
    .from('wallet_balances')
    .select('usd_value, wallets!inner(enterprise_id)')
    .eq('wallets.enterprise_id', enterpriseId);

  const walletTotal = (walletBalances || []).reduce(
    (sum, wb) => sum + (Number(wb.usd_value) || 0),
    0
  );

  // Sum bank account balances
  const { data: bankAccounts } = await supabase
    .from('bank_accounts')
    .select('balance')
    .eq('enterprise_id', enterpriseId);

  const bankTotal = (bankAccounts || []).reduce(
    (sum, ba) => sum + (Number(ba.balance) || 0),
    0
  );

  // Sum yield positions
  const { data: yieldPositions } = await supabase
    .from('yield_transactions')
    .select('amount')
    .eq('enterprise_id', enterpriseId)
    .eq('status', 'active');

  const yieldTotal = (yieldPositions || []).reduce(
    (sum, yp) => sum + (Number(yp.amount) || 0),
    0
  );

  return walletTotal + bankTotal + yieldTotal;
}

/** Check if an enterprise is at or above their asset cap */
export async function isAtAssetCap(enterpriseId: string, tier: TierSlug): Promise<boolean> {
  const cap = getAssetCap(tier);
  if (cap === null) return false;

  const total = await getTotalLiveAssets(enterpriseId);
  return total >= cap;
}

/** Get the number of live ERP configurations for an enterprise */
export async function getLiveErpCount(enterpriseId: string): Promise<number> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from('erp_configurations')
    .select('id', { count: 'exact', head: true })
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true);

  return count || 0;
}

/** Get the number of paid ERP add-ons for an enterprise */
export async function getPaidErpAddonCount(enterpriseId: string): Promise<number> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from('erp_addons')
    .select('id', { count: 'exact', head: true })
    .eq('enterprise_id', enterpriseId)
    .eq('active', true);

  return count || 0;
}

/** Check if an enterprise can add another live ERP */
export async function canAddErp(enterpriseId: string, tier: TierSlug): Promise<boolean> {
  if (!isPaidTier(tier)) return false;

  const currentCount = await getLiveErpCount(enterpriseId);
  const included = TIERS[tier].includedErps;
  const paidAddons = await getPaidErpAddonCount(enterpriseId);

  return currentCount < included + paidAddons;
}

/** Check if downgrade is allowed to a target tier */
export async function canDowngrade(
  enterpriseId: string,
  targetTier: TierSlug
): Promise<{ allowed: boolean; reason?: string }> {
  const targetCap = getAssetCap(targetTier);

  if (targetTier === 'lite') {
    return { allowed: true };
  }

  if (targetCap !== null) {
    const totalAssets = await getTotalLiveAssets(enterpriseId);
    if (totalAssets > targetCap) {
      return {
        allowed: false,
        reason: `Your connected assets ($${(totalAssets / 1_000_000).toFixed(1)}M) exceed the ${TIERS[targetTier].name} plan cap of $${(targetCap / 1_000_000).toFixed(0)}M.`,
      };
    }
  }

  return { allowed: true };
}
