import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Build a service-role Supabase client for integration tests. Must only be
 * used against the dev project — the service role bypasses RLS and can
 * destroy production data.
 */
export function getTestDb(): SupabaseClient {
  if (!url || !key) {
    throw new Error(
      'Test DB env missing: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. ' +
        'Ensure .env.local is present in the worktree root and tests/setup.ts is wired in vitest.config.ts.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Context returned by createTestEnterprise — a fully wired tenant with a
 * user_profile attached, plus an async cleanup that tears down both so the
 * dev DB doesn't accumulate test rows across runs.
 *
 * The DB wiring enforces three interlocking invariants:
 *   - obligations.enterprise_id -> enterprises(id)          ON DELETE CASCADE
 *   - obligations.user_id       -> user_profiles(id)        ON DELETE CASCADE
 *   - user_profiles.id          -> auth.users(id)           ON DELETE CASCADE
 *
 * So deleting the auth user alone cascades through user_profiles and any
 * obligations the test created; deleting the enterprise cascades obligations
 * by a second path. We run both deletes for belt-and-braces (an obligation
 * could be created without a user_id in principle — the current schema
 * requires it, but the repo signature may eventually loosen).
 */
export interface TestEnterpriseContext {
  enterpriseId: string;
  userId: string;
  cleanup: () => Promise<void>;
}

export async function createTestEnterprise(db: SupabaseClient): Promise<TestEnterpriseContext> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 1. Enterprise
  const { data: ent, error: entErr } = await db
    .from('enterprises')
    .insert({ name: `test-${suffix}`, status: 'active' })
    .select('id')
    .single();
  if (entErr) throw new Error(`createTestEnterprise: insert enterprise failed: ${entErr.message}`);
  const enterpriseId = ent.id as string;

  // 2. Auth user (required because user_profiles.id FKs to auth.users.id).
  //    Using supabase.auth.admin.createUser with the service role; email_confirm
  //    short-circuits the verification flow so the profile can be attached
  //    immediately.
  const email = `test-${suffix}@vantor-test.invalid`;
  const { data: authRes, error: authErr } = await db.auth.admin.createUser({
    email,
    password: `test-${suffix}-pw!`,
    email_confirm: true,
  });
  if (authErr || !authRes.user) {
    // Roll back the enterprise if user creation fails, otherwise we leak rows.
    await db.from('enterprises').delete().eq('id', enterpriseId);
    throw new Error(`createTestEnterprise: auth.admin.createUser failed: ${authErr?.message}`);
  }
  const userId = authRes.user.id;

  // 3. Attach the user_profile (auto-created by the `handle_new_user` trigger
  //    on auth.users — see migrations 0001/0019) to our test enterprise. We
  //    UPDATE rather than INSERT because the trigger has already written a
  //    row with the auth user's id; inserting would collide on the PK.
  const { error: profErr } = await db
    .from('user_profiles')
    .update({ enterprise_id: enterpriseId, role: 'auditor' })
    .eq('id', userId);
  if (profErr) {
    await db.auth.admin.deleteUser(userId);
    await db.from('enterprises').delete().eq('id', enterpriseId);
    throw new Error(`createTestEnterprise: update user_profile failed: ${profErr.message}`);
  }

  const cleanup = async (): Promise<void> => {
    // Order matters: delete obligations' user_id parent first so the CASCADE
    // through user_profiles fires before we drop the enterprise. We don't
    // actually care about the intermediate state — both deletes together
    // sweep everything.
    await db.auth.admin.deleteUser(userId).catch(() => undefined);
    // The enterprise delete MUST NOT silently fail. Before migration 0040 it
    // was blocked by a rewrite-rule / FK-cascade interaction on audit_logs and
    // several policy_* tables, and the silent failure let dev accumulate
    // dozens of stale test enterprises across runs. Surface any future error.
    const { error } = await db.from('enterprises').delete().eq('id', enterpriseId);
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(
        `[test-db] enterprise cleanup failed for ${enterpriseId}: ${error.message}`,
      );
    }
  };

  return { enterpriseId, userId, cleanup };
}
