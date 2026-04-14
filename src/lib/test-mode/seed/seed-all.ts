import { createAdminClient } from '@/lib/supabase/admin';
import type { SeedContext } from './helpers';
import { seedWallets } from './wallets';
import { seedBanking } from './banking';
import { seedErp } from './erp';
import { seedTransactions, seedFiatPayments } from './transactions';
import { seedSwaps } from './swaps';
import { seedBridges } from './bridges';
import { seedTreasury } from './treasury';
import { seedYield } from './yield';
import { seedCompliance } from './compliance';
import { seedAudit } from './audit';
import { seedPolicy } from './policy';
import { seedApprovals } from './approvals';
import { seedAnalytics } from './analytics';
import { seedInsights } from './insights';
import { seedNotifications } from './notifications';

/**
 * Seeds a test enterprise with comprehensive demo data across all domains.
 * Called during enterprise creation for Lite tier test mode.
 */
export async function seedAll(
  testEnterpriseId: string,
  sourceEnterpriseId: string,
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<void> {
  const supabase = adminClient || createAdminClient();

  const { data: users } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('enterprise_id', sourceEnterpriseId)
    .limit(1);

  const userId = users?.[0]?.id;
  if (!userId) {
    throw new Error(
      `seedAll: no user found for sourceEnterpriseId=${sourceEnterpriseId}. ` +
        `user_profiles.enterprise_id lookup returned zero rows — aborting before wipe leaves the ` +
        `test enterprise empty. (Past incident: reseed from test-enterprise page collapsed source → test id.)`,
    );
  }

  const ctx: SeedContext = { supabase, enterpriseId: testEnterpriseId, userId };

  // Phase 1: No dependencies
  const [walletIds, bankIds, erpIds] = await Promise.all([
    seedWallets(ctx),
    seedBanking(ctx),
    seedErp(ctx),
  ]);

  // Phase 2: Depend on wallets/erp/banking
  const [txIds] = await Promise.all([
    seedTransactions(ctx, walletIds, erpIds.invoiceIds),
    seedSwaps(ctx, walletIds),
    seedBridges(ctx, walletIds),
    seedFiatPayments(ctx, bankIds.bankAccountIds),
  ]);

  // Phase 3: Depend on wallets
  await Promise.all([
    seedTreasury(ctx),
    seedYield(ctx, walletIds),
  ]);

  // Phase 4: Depend on wallets + transactions
  await seedCompliance(ctx, walletIds, txIds);

  // Phase 5: Depend on everything
  await seedAudit(ctx);

  // Phase 6: Policy + approvals + analytics + insights + notifications.
  // Ordering:
  //   - policy first (approvals reference active version + chain)
  //   - analytics + insights can run in parallel (no deps on each other)
  //   - notifications last (references state that's now fully seeded)
  const policyIds = await seedPolicy(ctx);
  await seedApprovals(ctx, policyIds.v3Id, policyIds.chainId);
  await Promise.all([
    seedAnalytics(ctx),
    seedInsights(ctx),
  ]);
  await seedNotifications(ctx);
}
