import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { createTravelRuleTransfer } from '@/lib/compliance/travel-rule';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const createSchema = z.object({
  paymentId: z.string().uuid().optional(),
  direction: z.enum(['outgoing', 'incoming']),
  amountUsd: z.number().positive(),
  originatorName: z.string().min(1).max(300),
  originatorAddress: z.string().max(500).optional(),
  originatorWallet: z.string().min(20).max(100),
  originatorChain: z.enum(['ethereum', 'solana']),
  originatorVasp: z.string().max(300).optional(),
  beneficiaryName: z.string().min(1).max(300),
  beneficiaryAddress: z.string().max(500).optional(),
  beneficiaryWallet: z.string().min(20).max(100),
  beneficiaryChain: z.enum(['ethereum', 'solana']),
  beneficiaryVasp: z.string().max(300).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  let q = supabase
    .from('travel_rule_transfers')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!checkRateLimit('compliance-travel-rule', session.user.id, 30, 60 * 60 * 1000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const transfer = await createTravelRuleTransfer(
      session.user.id,
      parsed.data.paymentId ?? '',
      parsed.data
    );

    return NextResponse.json({ data: transfer }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
