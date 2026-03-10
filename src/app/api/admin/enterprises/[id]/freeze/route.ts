import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.is_app_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();
  const { id } = params;

  try {
    // Verify enterprise exists
    const { data: existing, error: fetchError } = await supabase
      .from('enterprises')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Enterprise not found' }, { status: 404 });
    }

    if (existing.status === 'frozen') {
      return NextResponse.json({ error: 'Enterprise is already frozen' }, { status: 409 });
    }

    // Freeze the enterprise
    const { data, error } = await supabase
      .from('enterprises')
      .update({ status: 'frozen' })
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: session.user.id,
      action: 'enterprise_frozen',
      details: {
        enterprise_id: id,
        previous_status: existing.status,
      },
    });

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
