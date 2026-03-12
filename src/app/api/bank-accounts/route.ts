import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const supabase = createAdminClient();
  let query = supabase
    .from('bank_accounts')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('is_active', true);
  if (enterpriseId) query = query.eq('enterprise_id', enterpriseId);
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

const addSchema = z.object({
  institution_name: z.string().min(1).max(200),
  nickname: z.string().max(200).optional(),
  account_type: z.enum(['checking', 'savings']).default('checking'),
  last4: z.string().length(4).optional(),
  routing_number: z.string().max(20).optional(),
  currency: z.string().length(3).default('USD'),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const body = await req.json();
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();
  const { data: account, error } = await supabase
    .from('bank_accounts')
    .insert({
      user_id: session.user.id,
      ...(enterpriseId ? { enterprise_id: enterpriseId } : {}),
      institution_name: parsed.data.institution_name,
      account_name: parsed.data.institution_name,
      nickname: parsed.data.nickname?.trim() || null,
      account_type: parsed.data.account_type,
      last4: parsed.data.last4 ?? null,
      routing_number: parsed.data.routing_number ?? null,
      currency: parsed.data.currency,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'bank_account_connect',
    entityType: 'bank_account',
    entityId: account.id,
    details: { institution: parsed.data.institution_name, method: 'manual' },
  });

  return NextResponse.json({ data: account }, { status: 201 });
}
