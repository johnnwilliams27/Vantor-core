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

    // Count transactions (count only, NO amounts)
    const { count: transactionCount, error: txError } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('enterprise_id', id);

    if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

    return NextResponse.json({
      data: {
        ...enterprise,
        user_count: userCount ?? 0,
        transaction_count: transactionCount ?? 0,
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
