import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { wipeTestEnterprise } from '@/lib/test-mode/seed/wipe';
import { seedAll } from '@/lib/test-mode/seed/seed-all';

export async function POST(req: NextRequest) {
  let enterpriseId: string | null = null;

  // Allow admin key auth for CLI/scripts (uses SUPABASE_SERVICE_ROLE_KEY as shared secret)
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (token && serviceKey && token === serviceKey) {
    const { searchParams } = new URL(req.url);
    enterpriseId = searchParams.get('enterpriseId');
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    enterpriseId = session.user.enterprise_id;
  }

  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: enterprise } = await supabase
    .from('enterprises')
    .select('test_enterprise_id')
    .eq('id', enterpriseId)
    .single();

  const testId = enterprise?.test_enterprise_id;
  if (!testId) {
    return NextResponse.json({ error: 'No test enterprise found' }, { status: 404 });
  }

  // Reset the wiped flag so wipe can run again
  await supabase
    .from('enterprises')
    .update({ test_data_wiped_at: null })
    .eq('id', testId);

  // Wipe existing test data, then re-seed
  const wipeResult = await wipeTestEnterprise(testId, supabase);
  if (!wipeResult.success) {
    return NextResponse.json({ error: wipeResult.error }, { status: 500 });
  }

  // Clear the wiped flag again since we're about to re-seed
  await supabase
    .from('enterprises')
    .update({ test_data_wiped_at: null })
    .eq('id', testId);

  await seedAll(testId, enterpriseId, supabase);

  return NextResponse.json({ ok: true, testEnterpriseId: testId });
}
