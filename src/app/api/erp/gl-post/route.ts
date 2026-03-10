import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getERPAdapter, decryptCredentials } from '@/lib/erp/factory';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import type { ErpProvider } from '@/types/database';

const schema = z.object({
  erpConfigId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  paymentId: z.string().uuid().optional(),
  amount: z.string(),
  token: z.enum(['USDC', 'USDT', 'PYUSD']),
  glAccount: z.string().min(1).max(100),
  memo: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: erpConfig } = await supabase
    .from('erp_configurations')
    .select('*')
    .eq('id', parsed.data.erpConfigId)
    .eq('user_id', session.user.id)
    .single();

  if (!erpConfig) return NextResponse.json({ error: 'ERP config not found' }, { status: 404 });

  const credentials = decryptCredentials(erpConfig.credentials);
  const adapter = getERPAdapter(erpConfig.provider as ErpProvider, credentials);

  const result = await adapter.postGLEntry({
    invoiceId: parsed.data.invoiceId ?? '',
    paymentId: parsed.data.paymentId ?? '',
    amount: parseFloat(parsed.data.amount),
    token: parsed.data.token,
    glAccount: parsed.data.glAccount,
    memo: parsed.data.memo,
  });

  const { data: posting, error } = await supabase
    .from('gl_postings')
    .insert({
      user_id: session.user.id,
      erp_config_id: parsed.data.erpConfigId,
      invoice_id: parsed.data.invoiceId ?? null,
      payment_id: parsed.data.paymentId ?? null,
      external_gl_id: result.externalGlId,
      amount: parsed.data.amount,
      token: parsed.data.token,
      gl_account: parsed.data.glAccount,
      status: result.status,
      response_data: result as unknown as Record<string, unknown>,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'gl_post',
    entityType: 'gl_posting',
    entityId: posting.id,
    details: { glAccount: parsed.data.glAccount, amount: parsed.data.amount },
  });

  return NextResponse.json({ data: posting });
}
