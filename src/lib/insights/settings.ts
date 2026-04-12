/**
 * Per-enterprise settings for the Treasury Insights Engine.
 *
 * Replaces the hardcoded `balanced` / `scale` defaults that the v1 cron and
 * inline runners used as placeholders. One row per enterprise in
 * `customer_insight_settings`.
 *
 * `resolveInsightSettings()` is the single read-path used by both the cron
 * orchestrator and the inline trigger runner. First call for an enterprise
 * lazily inserts a row with defaults — no backfill migration needed for
 * existing enterprises.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import type { RiskProfileId, AumTier } from './types';

export interface InsightSettings {
  enterpriseId: string;
  riskProfileId: RiskProfileId;
  aumTier: AumTier;
}

/**
 * Default values for a newly-seen enterprise. These match the v1 hardcoded
 * placeholders so behavior is unchanged until a customer explicitly updates
 * their settings.
 */
export const DEFAULT_INSIGHT_SETTINGS = {
  riskProfileId: 'balanced' as RiskProfileId,
  aumTier: 'scale' as AumTier,
} as const;

/**
 * Reads insight settings for an enterprise. Inserts a default row if none
 * exists yet. Safe to call concurrently — the upsert uses `ignoreDuplicates`
 * so racing calls from cron and inline triggers won't collide.
 */
export async function resolveInsightSettings(
  enterpriseId: string,
  client?: SupabaseClient,
): Promise<InsightSettings> {
  const db = client ?? createAdminClient();

  const { error: upsertError } = await db
    .from('customer_insight_settings')
    .upsert(
      {
        enterprise_id: enterpriseId,
        risk_profile_id: DEFAULT_INSIGHT_SETTINGS.riskProfileId,
        aum_tier: DEFAULT_INSIGHT_SETTINGS.aumTier,
      },
      { onConflict: 'enterprise_id', ignoreDuplicates: true },
    );

  if (upsertError) {
    throw new Error(
      `Failed to upsert insight settings for enterprise ${enterpriseId}: ${upsertError.message}`,
    );
  }

  const { data, error } = await db
    .from('customer_insight_settings')
    .select('enterprise_id, risk_profile_id, aum_tier')
    .eq('enterprise_id', enterpriseId)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to read insight settings for enterprise ${enterpriseId}: ${error?.message ?? 'row not found'}`,
    );
  }

  return {
    enterpriseId: data.enterprise_id,
    riskProfileId: data.risk_profile_id as RiskProfileId,
    aumTier: data.aum_tier as AumTier,
  };
}

/**
 * Updates insight settings for an enterprise. Partial update — only provided
 * fields are written. Used by the settings UI (future) and can be called
 * directly from scripts/admin tools.
 */
export async function updateInsightSettings(
  enterpriseId: string,
  patch: Partial<Pick<InsightSettings, 'riskProfileId' | 'aumTier'>>,
  client?: SupabaseClient,
): Promise<InsightSettings> {
  const db = client ?? createAdminClient();

  // Ensure a row exists before updating so the call is idempotent for
  // enterprises that have never been through the resolver yet.
  await resolveInsightSettings(enterpriseId, db);

  const update: Record<string, string> = {};
  if (patch.riskProfileId !== undefined) update.risk_profile_id = patch.riskProfileId;
  if (patch.aumTier !== undefined) update.aum_tier = patch.aumTier;

  if (Object.keys(update).length === 0) {
    return resolveInsightSettings(enterpriseId, db);
  }

  const { data, error } = await db
    .from('customer_insight_settings')
    .update(update)
    .eq('enterprise_id', enterpriseId)
    .select('enterprise_id, risk_profile_id, aum_tier')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update insight settings for enterprise ${enterpriseId}: ${error?.message ?? 'row not found'}`,
    );
  }

  return {
    enterpriseId: data.enterprise_id,
    riskProfileId: data.risk_profile_id as RiskProfileId,
    aumTier: data.aum_tier as AumTier,
  };
}
