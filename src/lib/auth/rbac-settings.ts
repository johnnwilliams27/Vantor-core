/**
 * Per-enterprise RBAC settings.
 *
 * Currently holds one knob: `author_approver_separation_enabled`.
 * When true (the default), `validateSoD` rejects an approval if the
 * approver authored any rule that triggered the approval request
 * (sod_rule_editor_conflict). When false, the check is skipped —
 * small orgs where authoring and approving overlap by necessity can
 * opt out with a clear audit trail.
 *
 * Mirrors the pattern used by `src/lib/insights/settings.ts`:
 *   - One row per enterprise in `enterprise_rbac_settings`
 *   - Lazy upsert on first access — no backfill needed
 *   - Safe for concurrent callers via `ignoreDuplicates`
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export interface RbacSettings {
  enterpriseId: string;
  authorApproverSeparationEnabled: boolean;
}

/**
 * Default values for an enterprise that has never set its RBAC knobs.
 * `true` matches the product decision: strict separation by default,
 * opt-out only when the org explicitly chooses.
 */
export const DEFAULT_RBAC_SETTINGS = {
  authorApproverSeparationEnabled: true,
} as const;

/**
 * Reads RBAC settings for an enterprise. Inserts a default row if none
 * exists yet. Safe to call concurrently — upsert uses
 * `ignoreDuplicates` so racing callers won't collide.
 */
export async function resolveRbacSettings(
  enterpriseId: string,
  client?: SupabaseClient,
): Promise<RbacSettings> {
  const db = client ?? createAdminClient();

  const { error: upsertError } = await db
    .from('enterprise_rbac_settings')
    .upsert(
      {
        enterprise_id: enterpriseId,
        author_approver_separation_enabled:
          DEFAULT_RBAC_SETTINGS.authorApproverSeparationEnabled,
      },
      { onConflict: 'enterprise_id', ignoreDuplicates: true },
    );

  if (upsertError) {
    throw new Error(
      `Failed to upsert RBAC settings for enterprise ${enterpriseId}: ${upsertError.message}`,
    );
  }

  const { data, error } = await db
    .from('enterprise_rbac_settings')
    .select('enterprise_id, author_approver_separation_enabled')
    .eq('enterprise_id', enterpriseId)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to read RBAC settings for enterprise ${enterpriseId}: ${error?.message ?? 'row not found'}`,
    );
  }

  return {
    enterpriseId: data.enterprise_id,
    authorApproverSeparationEnabled: data.author_approver_separation_enabled,
  };
}

/**
 * Updates RBAC settings for an enterprise. Partial — only provided
 * fields are written. Lazy-resolves defaults first so the call is
 * idempotent for enterprises never seen before.
 */
export async function updateRbacSettings(
  enterpriseId: string,
  patch: Partial<Pick<RbacSettings, 'authorApproverSeparationEnabled'>>,
  client?: SupabaseClient,
): Promise<RbacSettings> {
  const db = client ?? createAdminClient();

  await resolveRbacSettings(enterpriseId, db);

  const update: Record<string, boolean> = {};
  if (patch.authorApproverSeparationEnabled !== undefined) {
    update.author_approver_separation_enabled = patch.authorApproverSeparationEnabled;
  }

  if (Object.keys(update).length === 0) {
    return resolveRbacSettings(enterpriseId, db);
  }

  const { data, error } = await db
    .from('enterprise_rbac_settings')
    .update(update)
    .eq('enterprise_id', enterpriseId)
    .select('enterprise_id, author_approver_separation_enabled')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update RBAC settings for enterprise ${enterpriseId}: ${error?.message ?? 'row not found'}`,
    );
  }

  return {
    enterpriseId: data.enterprise_id,
    authorApproverSeparationEnabled: data.author_approver_separation_enabled,
  };
}
