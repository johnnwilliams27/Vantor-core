/**
 * POST /api/insights/mark-all-viewed
 *
 * Bulk-transitions every `new`-state insight for the authenticated
 * user's effective enterprise to `viewed`, in a single UPDATE.
 *
 * Used by the InsightFeed frontend on mount to mark the whole visible
 * feed as seen in one round-trip instead of firing N PATCH calls.
 * Idempotent — subsequent calls return `{ count: 0 }` because there
 * are no more `new`-state insights to transition.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { markAllViewed } from '@/lib/insights/store';

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    requireRole(session.user.role as any, 'accountant');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise context' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const count = await markAllViewed(enterpriseId, session.user.id, supabase);
    return NextResponse.json({ data: { count } });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
