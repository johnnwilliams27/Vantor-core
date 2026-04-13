import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { wipeTestEnterprise } from '@/lib/test-mode/seed/wipe';
import { seedAll } from '@/lib/test-mode/seed/seed-all';

/**
 * Admin-only endpoint: wipes + re-seeds the test enterprise linked to a given
 * real enterprise. Used by the "Reset test data" button on the admin enterprise
 * detail page.
 *
 * Differs from /api/test-mode/reseed in that:
 *   - Caller is an app admin acting on behalf of any enterprise (not their own)
 *   - Auth is via NextAuth session + is_app_admin flag
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.is_app_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();
  const { id } = params;

  // Resolve the test_enterprise_id from the real enterprise
  const { data: ent, error: entErr } = await supabase
    .from('enterprises')
    .select('id, name, test_enterprise_id, is_test_enterprise')
    .eq('id', id)
    .single();

  if (entErr || !ent) {
    return NextResponse.json({ error: 'Enterprise not found' }, { status: 404 });
  }

  // Resolve both test enterprise id and the REAL enterprise id — seedAll needs
  // the real one to find a user (users are associated with the real enterprise,
  // not the test one). Accept either:
  //   (a) admin passed the real enterprise id: walk to test_enterprise_id
  //   (b) admin passed the test enterprise id: reverse-lookup the real one
  let testEnterpriseId: string | null = null;
  let realEnterpriseId: string | null = null;

  if (ent.is_test_enterprise) {
    // Passed the test enterprise id — find the real enterprise that links to it
    testEnterpriseId = ent.id;
    const { data: real } = await supabase
      .from('enterprises')
      .select('id')
      .eq('test_enterprise_id', ent.id)
      .maybeSingle();
    realEnterpriseId = real?.id ?? null;
  } else if (ent.test_enterprise_id) {
    // Passed the real enterprise id
    testEnterpriseId = ent.test_enterprise_id;
    realEnterpriseId = ent.id;
  }

  if (!testEnterpriseId) {
    return NextResponse.json(
      { error: 'No test enterprise linked to this enterprise' },
      { status: 404 }
    );
  }
  if (!realEnterpriseId) {
    return NextResponse.json(
      { error: 'Could not resolve the real enterprise that owns this test enterprise' },
      { status: 404 }
    );
  }

  // Reset the wiped flag so wipe can run again (idempotency guard)
  await supabase
    .from('enterprises')
    .update({ test_data_wiped_at: null })
    .eq('id', testEnterpriseId);

  // Wipe + reseed
  const wipeResult = await wipeTestEnterprise(testEnterpriseId, supabase);
  if (!wipeResult.success) {
    return NextResponse.json({ error: wipeResult.error ?? 'wipe failed' }, { status: 500 });
  }

  // Clear the wiped flag again since we're about to re-seed
  await supabase
    .from('enterprises')
    .update({ test_data_wiped_at: null })
    .eq('id', testEnterpriseId);

  // seedAll resolves the userId from user_profiles.enterprise_id = sourceEnterpriseId.
  // Users live under the REAL enterprise, so we must pass realEnterpriseId here.
  // Prior bug: when admin clicked the button from the test enterprise's own detail
  // page, sourceEnterpriseId collapsed to the test id and userId resolution returned
  // null, causing seedAll to early-return with zero rows written.
  try {
    await seedAll(testEnterpriseId, realEnterpriseId, supabase);
  } catch (err) {
    console.error('[admin reseed] seedAll threw', err);
    return NextResponse.json(
      { error: `Seed failed: ${(err as Error).message ?? 'unknown'}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, testEnterpriseId });
}
