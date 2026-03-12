import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const querySchema = z.object({
  chain: z.enum(['ethereum', 'solana']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    chain: searchParams.get('chain') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
  const { chain, limit, offset } = parsed.data;

  const supabase = createAdminClient();

  let query = supabase
    .from('transactions')
    .select('*', { count: 'exact' })
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1);

  if (chain) query = query.eq('chain', chain);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, total: count ?? 0, offset, limit });
}
