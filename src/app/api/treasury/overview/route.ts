import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { buildTreasurySnapshot } from '@/lib/treasury/rules-engine';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const supabase = createAdminClient();

  try {
    const snapshot = await buildTreasurySnapshot(supabase, session.user.id);

    // Also fetch pending recommendations count
    const { data: pendingRecs } = await supabase
      .from('ai_recommendations')
      .select('id, action, recommended_amount_usd, status, expires_at, created_at')
      .eq('user_id', session.user.id)
      .eq('status', 'pending_approval')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    return NextResponse.json({
      data: {
        ...snapshot,
        pendingRecommendations: pendingRecs ?? [],
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
