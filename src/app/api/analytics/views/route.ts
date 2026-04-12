import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { STANDARD_VIEWS } from '@/lib/analytics/standard-views';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const standardViews = STANDARD_VIEWS.map((v) => ({
    id: v.id,
    slug: v.slug,
    label: v.label,
    description: v.description,
    kind: v.kind,
    chartType: v.chartType,
    config: v.config,
    sortOrder: v.sortOrder,
  }));

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ data: standardViews });
  }

  // Fetch custom views for this enterprise
  const supabase = createAdminClient();
  const { data: customRows } = await supabase
    .from('analytics_views')
    .select('id, slug, label, description, kind, chart_type, config, sort_order, forked_from, created_at, updated_at')
    .eq('enterprise_id', enterpriseId)
    .eq('kind', 'custom')
    .order('created_at', { ascending: true });

  const customViews = (customRows ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    description: r.description,
    kind: r.kind as 'custom',
    chartType: r.chart_type,
    config: r.config,
    sortOrder: r.sort_order,
    forkedFrom: r.forked_from,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json({ data: [...standardViews, ...customViews] });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    requireRole(session.user.role as any, 'treasury_manager');
  } catch {
    return NextResponse.json({ error: 'Forbidden — treasury_manager or enterprise_admin required' }, { status: 403 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise' }, { status: 400 });
  }

  let body: {
    label?: string;
    slug?: string;
    chartType?: string;
    config?: Record<string, unknown>;
    forkedFrom?: string;
    description?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.label || !body.slug) {
    return NextResponse.json({ error: 'label and slug are required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('analytics_views')
    .insert({
      enterprise_id: enterpriseId,
      slug: body.slug,
      label: body.label,
      description: body.description ?? null,
      kind: 'custom',
      chart_type: body.chartType ?? 'table',
      config: body.config ?? {},
      forked_from: body.forkedFrom ?? null,
      sort_order: 100, // custom views sort after standard
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A view with this slug already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create view' }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
