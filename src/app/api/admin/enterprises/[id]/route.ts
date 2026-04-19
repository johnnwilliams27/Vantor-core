import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.is_app_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();
  const { id } = params;

  try {
    // Fetch enterprise
    const { data: enterprise, error } = await supabase
      .from('enterprises')
      .select('id, name, status, kyc_status, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !enterprise) {
      return NextResponse.json({ error: 'Enterprise not found' }, { status: 404 });
    }

    // Count users in this enterprise (no financial data)
    const { count: userCount, error: ucError } = await supabase
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('enterprise_id', id);

    if (ucError) return NextResponse.json({ error: ucError.message }, { status: 500 });

    // Count transactions across all three tx tables (count only, NO amounts).
    // fiat_transactions has no enterprise_id — scope via this enterprise's users.
    const { data: userIdRows, error: uidErr } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('enterprise_id', id);

    if (uidErr) return NextResponse.json({ error: uidErr.message }, { status: 500 });

    const userIds = (userIdRows ?? []).map((r) => r.id);

    const [stablecoinRes, fiatRes, yieldRes] = await Promise.all([
      supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('enterprise_id', id),
      userIds.length
        ? supabase
            .from('fiat_transactions')
            .select('id', { count: 'exact', head: true })
            .in('user_id', userIds)
        : Promise.resolve({ count: 0, error: null as { message: string } | null }),
      supabase
        .from('yield_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('enterprise_id', id),
    ]);

    if (stablecoinRes.error) return NextResponse.json({ error: stablecoinRes.error.message }, { status: 500 });
    if (fiatRes.error) return NextResponse.json({ error: fiatRes.error.message }, { status: 500 });
    if (yieldRes.error) return NextResponse.json({ error: yieldRes.error.message }, { status: 500 });

    const transactionCount =
      (stablecoinRes.count ?? 0) + (fiatRes.count ?? 0) + (yieldRes.count ?? 0);

    // Fetch admin email
    const { data: admins, error: adminError } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('enterprise_id', id)
      .eq('role', 'enterprise_admin')
      .limit(1);

    const adminEmail = adminError ? undefined : (admins?.[0]?.email);

    // Recent audit logs for this enterprise (new behavior — previously this
    // field was read by the UI but never populated).
    const { data: auditRows, error: auditError } = await supabase
      .from('audit_logs')
      .select('id, action, entity_type, entity_id, user_id, created_at')
      .eq('enterprise_id', id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });

    const auditUserIds = Array.from(
      new Set((auditRows ?? []).map((r) => r.user_id).filter((uid): uid is string => !!uid)),
    );
    const emailById: Record<string, string> = {};
    if (auditUserIds.length > 0) {
      const { data: emailRows } = await supabase
        .from('user_profiles')
        .select('id, email')
        .in('id', auditUserIds);
      for (const row of emailRows ?? []) {
        if (row.id && row.email) emailById[row.id] = row.email;
      }
    }

    const recentAuditLogs = (auditRows ?? []).map((r) => ({
      ...r,
      user_email: r.user_id ? emailById[r.user_id] ?? null : null,
    }));

    return NextResponse.json({
      data: {
        ...enterprise,
        user_count: userCount ?? 0,
        transaction_count: transactionCount ?? 0,
        admin_email: adminEmail,
        recent_audit_logs: recentAuditLogs,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.is_app_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();
  const { id } = params;

  try {
    const body = await req.json();
    const allowedFields = ['name', 'status', 'kyc_status'] as const;
    const updates: Record<string, string> = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'string' || body[field].trim().length === 0) {
          return NextResponse.json({ error: `${field} must be a non-empty string` }, { status: 400 });
        }
        updates[field] = body[field].trim();
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('enterprises')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Enterprise not found' }, { status: 404 });

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: session.user.id,
      action: 'enterprise_updated',
      details: { enterprise_id: id, updates },
    });

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
