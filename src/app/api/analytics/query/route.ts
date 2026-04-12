import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { executeView } from '@/lib/analytics/engine';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { viewSlug, from, to, filters, groupBy, granularity, page, pageSize } = body;

  if (!viewSlug || typeof viewSlug !== 'string') {
    return NextResponse.json({ error: 'viewSlug is required' }, { status: 400 });
  }
  if (!from || typeof from !== 'string' || !DATE_RE.test(from)) {
    return NextResponse.json({ error: 'from is required (YYYY-MM-DD)' }, { status: 400 });
  }
  if (!to || typeof to !== 'string' || !DATE_RE.test(to)) {
    return NextResponse.json({ error: 'to is required (YYYY-MM-DD)' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const result = await executeView(supabase, enterpriseId, viewSlug as string, {
      from: from as string,
      to: to as string,
      filters: filters as Record<string, string | string[]> | undefined,
      groupBy: groupBy as string | undefined,
      granularity: granularity as any,
      page: page as number | undefined,
      pageSize: pageSize as number | undefined,
    });

    return NextResponse.json({ data: result });
  } catch (err: any) {
    const message = err?.message ?? 'Internal error';
    const status = message.includes('Unknown view') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
