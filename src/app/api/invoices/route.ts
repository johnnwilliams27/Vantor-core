import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const INVOICE_STATUSES = ['draft', 'pending', 'paid', 'overdue', 'cancelled'] as const;

const createSchema = z.object({
  invoiceNumber: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  amount: z.string().max(50),
  token: z.enum(['USDC', 'USDT', 'PYUSD']),
  chain: z.enum(['ethereum', 'solana']),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vendorId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get('status');
  const status = rawStatus && (INVOICE_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : null;
  const supabase = createAdminClient();

  let query = supabase
    .from('invoices')
    .select('*, vendor:erp_vendors(*)')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      invoice_number: parsed.data.invoiceNumber,
      description: parsed.data.description,
      amount: parsed.data.amount,
      token: parsed.data.token,
      chain: parsed.data.chain,
      due_date: parsed.data.dueDate,
      vendor_id: parsed.data.vendorId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'invoice_create',
    entityType: 'invoice',
    entityId: data.id,
    details: { invoiceNumber: data.invoice_number, amount: data.amount },
  });

  return NextResponse.json({ data }, { status: 201 });
}
