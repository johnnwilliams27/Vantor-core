import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

const linkSchema = z.object({
  chain: z.enum(['ethereum', 'solana']),
  address: z.string().min(32).max(44),
  label: z.string().optional(),
});

// Manual (watch-only) wallet link — no signature required, saved as unverified
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  const { chain, address, label } = parsed.data;
  const supabase = createAdminClient();

  const { data: wallet, error } = await supabase
    .from('wallets')
    .upsert(
      { user_id: session.user.id, chain, address, label: label ?? null, verified_at: null },
      { onConflict: 'user_id,chain,address', ignoreDuplicates: true }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'wallet_connect',
    entityType: 'wallet',
    entityId: wallet.id,
    details: { chain, address, method: 'manual' },
  });

  return NextResponse.json({ data: wallet });
}
