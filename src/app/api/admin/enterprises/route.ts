import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.is_app_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();

  try {
    // Fetch all enterprises
    const { data: enterprises, error } = await supabase
      .from('enterprises')
      .select('id, name, status, kyc_status, created_at')
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Attach user counts per enterprise
    const { data: userCounts, error: ucError } = await supabase
      .from('user_profiles')
      .select('enterprise_id');

    if (ucError) return NextResponse.json({ error: ucError.message }, { status: 500 });

    const countMap: Record<string, number> = {};
    for (const row of userCounts ?? []) {
      if (row.enterprise_id) {
        countMap[row.enterprise_id] = (countMap[row.enterprise_id] ?? 0) + 1;
      }
    }

    const result = (enterprises ?? []).map((e) => ({
      ...e,
      user_count: countMap[e.id] ?? 0,
    }));

    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.is_app_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();

  try {
    const body = await req.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('enterprises')
      .insert({
        name: name.trim(),
        status: 'active',
        kyc_status: 'pending',
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: session.user.id,
      action: 'enterprise_created',
      details: { enterprise_id: data.id, name: data.name },
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
