import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { screenAddressWithCache } from '@/lib/compliance/screening';
import { z } from 'zod';

const screenSchema = z.object({
  address: z.string().min(20).max(100),
  chain: z.enum(['ethereum', 'solana']),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);
  const result = searchParams.get('result');

  let q = supabase
    .from('sanctions_screenings')
    .select('*')
    .eq('user_id', session.user.id)
    .order('screened_at', { ascending: false })
    .limit(100);

  if (result) q = q.eq('result', result);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = screenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const screening = await screenAddressWithCache(
      session.user.id,
      parsed.data.address,
      parsed.data.chain
    );

    return NextResponse.json({ data: screening });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
