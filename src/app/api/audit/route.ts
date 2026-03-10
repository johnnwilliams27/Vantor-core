import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  action: z.string().max(100).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
    action: searchParams.get('action') ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
  const { limit, offset, action } = parsed.data;

  const supabase = createAdminClient();

  // Treasury managers can see all audit logs; others see only their own
  const role = session.user.role;
  let query = supabase
    .from('audit_logs')
    .select('*, user_profile:user_profiles(email, full_name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (role !== 'treasury_manager') {
    query = query.eq('user_id', session.user.id);
  }

  if (action) query = query.eq('action', action);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, total: count ?? 0, offset, limit });
}
