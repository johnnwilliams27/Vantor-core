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

  // Accept either: (a) pass real enterprise id and we follow test_enterprise_id,
  // or (b) pass test enterprise id directly (useful if admin looked it up manually).
  let testEnterpriseId: string | null = null;
  if (ent.is_test_enterprise) {
    testEnterpriseId = ent.id;
  } else if (ent.test_enterprise_id) {
    testEnterpriseId = ent.test_enterprise_id;
  }

  if (!testEnterpriseId) {
    return NextResponse.json(
      { error: 'No test enterprise linked to this enterprise' },
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

  // Source enterprise for user resolution inside seedAll
  const sourceEnterpriseId = ent.is_test_enterprise ? id : ent.id;
  await seedAll(testEnterpriseId, sourceEnterpriseId, supabase);

  // Audit log
  await supabase.from('audit_logs').insert({
    user_id: session.user.id,
    action: 'admin_reseed_test_enterprise',
    details: {
      enterprise_id: id,
      test_enterprise_id: testEnterpriseId,
    },
  });

  return NextResponse.json({ ok: true, testEnterpriseId });
}
