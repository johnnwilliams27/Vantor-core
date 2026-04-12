import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { getStandardView } from '@/lib/analytics/standard-views';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check standard views first (by slug or id)
  const standard = getStandardView(params.id);
  if (standard) {
    return NextResponse.json({
      data: {
        id: standard.id,
        slug: standard.slug,
        label: standard.label,
        description: standard.description,
        kind: standard.kind,
        chartType: standard.chartType,
        config: standard.config,
        sortOrder: standard.sortOrder,
      },
    });
  }

  // Fall back to custom views in the database
  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const supabase = createAdminClient();
  const { data: view, error } = await supabase
    .from('analytics_views')
    .select('*')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (error || !view) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ data: view });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    requireRole(session.user.role as any, 'treasury_manager');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Standard views cannot be edited
  const standard = getStandardView(params.id);
  if (standard) {
    return NextResponse.json({ error: 'Standard views cannot be edited' }, { status: 403 });
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

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.label !== undefined) updates.label = body.label;
  if (body.description !== undefined) updates.description = body.description;
  if (body.config !== undefined) updates.config = body.config;
  if (body.chart_type !== undefined) updates.chart_type = body.chart_type;

  const supabase = createAdminClient();
  const { data: view, error } = await supabase
    .from('analytics_views')
    .update(updates)
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .select()
    .single();

  if (error || !view) {
    return NextResponse.json({ error: 'Not found or update failed' }, { status: 404 });
  }

  return NextResponse.json({ data: view });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    requireRole(session.user.role as any, 'treasury_manager');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Standard views cannot be deleted
  const standard = getStandardView(params.id);
  if (standard) {
    return NextResponse.json({ error: 'Standard views cannot be deleted' }, { status: 403 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise context' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('analytics_views')
    .delete()
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId);

  if (error) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }

  return NextResponse.json({ data: { deleted: true } });
}
