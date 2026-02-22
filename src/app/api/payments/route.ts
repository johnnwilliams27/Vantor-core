import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { executePayment } from '@/lib/payments/executor';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';

const schema = z.object({
  fromWalletId: z.string().uuid(),
  toAddress: z.string(),
  chain: z.enum(['ethereum', 'solana']),
  token: z.enum(['USDC', 'USDT', 'PYUSD']),
  amount: z.string(),
  memo: z.string().optional(),
  invoiceId: z.string().uuid().optional(),
  erpConfigId: z.string().uuid().optional(),
  scheduledFor: z.string().optional(),  // ISO timestamp for scheduled payments
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const supabase = createAdminClient();

  const base = supabase
    .from('payments')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false });

  // Try with ERP join (requires erp_config_id column migration to have run)
  let q = base.select('*, from_wallet:wallets(*), invoice:invoices(*), erp_config:erp_configurations(id, label, provider)');
  if (status) q = q.eq('status', status);
  let { data, error } = await q;

  if (error) {
    // Column not yet migrated — fall back to query without ERP join
    let q2 = base.select('*, from_wallet:wallets(*), invoice:invoices(*)');
    if (status) q2 = q2.eq('status', status);
    ({ data, error } = await q2);
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Verify wallet belongs to user
  const { data: wallet } = await supabase
    .from('wallets')
    .select('id, chain')
    .eq('id', parsed.data.fromWalletId)
    .eq('user_id', session.user.id)
    .single();

  if (!wallet) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });

  const isScheduled = !!parsed.data.scheduledFor;

  // Create payment record
  const { data: payment, error: pErr } = await supabase
    .from('payments')
    .insert({
      user_id: session.user.id,
      from_wallet_id: parsed.data.fromWalletId,
      to_address: parsed.data.toAddress,
      chain: parsed.data.chain,
      token: parsed.data.token,
      amount: parsed.data.amount,
      memo: parsed.data.memo ?? null,
      invoice_id: parsed.data.invoiceId ?? null,
      erp_config_id: parsed.data.erpConfigId ?? null,
      scheduled_for: parsed.data.scheduledFor ?? null,
      status: 'pending',
    })
    .select()
    .single();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: isScheduled ? 'payment_schedule' : 'payment_create',
    entityType: 'payment',
    entityId: payment.id,
    details: {
      chain: payment.chain,
      token: payment.token,
      amount: payment.amount,
      scheduledFor: payment.scheduled_for,
    },
  });

  // Execute immediately if not scheduled
  if (!isScheduled) {
    const result = await executePayment(payment);
    return NextResponse.json({ data: { ...payment, ...result } });
  }

  return NextResponse.json({ data: payment }, { status: 201 });
}
