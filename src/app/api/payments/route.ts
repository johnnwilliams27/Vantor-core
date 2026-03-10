import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { executePayment } from '@/lib/payments/executor';
import { writeAuditLog } from '@/lib/audit/logger';
import { screenAddressWithCache } from '@/lib/compliance/screening';
import { isAboveTravelRuleThreshold, createTravelRuleTransfer } from '@/lib/compliance/travel-rule';
import { z } from 'zod';

const PAYMENT_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;

const schema = z.object({
  fromWalletId: z.string().uuid(),
  toAddress: z.string().min(32).max(100),
  chain: z.enum(['ethereum', 'solana']),
  token: z.enum(['USDC', 'USDT', 'PYUSD']),
  amount: z.string().max(50),
  memo: z.string().max(2000).optional(),
  invoiceId: z.string().uuid().optional(),
  erpConfigId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime().optional(),
  // Travel Rule fields (required when amount >= threshold)
  travelRule: z.object({
    originatorName: z.string().min(1),
    originatorAddress: z.string().optional(),
    beneficiaryName: z.string().min(1),
    beneficiaryAddress: z.string().optional(),
    beneficiaryVasp: z.string().optional(),
  }).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get('status');
  const status = rawStatus && (PAYMENT_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : null;
  const supabase = createAdminClient();

  // Try with ERP join (requires erp_config_id column migration to have run)
  let q = supabase
    .from('payments')
    .select('*, from_wallet:wallets(*), invoice:invoices(*), erp_config:erp_configurations(id, label, provider)')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  let { data, error } = await q;

  if (error) {
    // Column not yet migrated — fall back to query without ERP join
    let q2 = supabase
      .from('payments')
      .select('*, from_wallet:wallets(*), invoice:invoices(*)')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    if (status) q2 = q2.eq('status', status as string);
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

  // --- Sanctions screening (pre-creation gate) ---
  try {
    const screening = await screenAddressWithCache(
      session.user.id,
      parsed.data.toAddress,
      parsed.data.chain
    );
    if (screening.result === 'sanctioned') {
      return NextResponse.json(
        { error: 'Recipient address is on a sanctions list', screening },
        { status: 403 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Sanctions screening failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  // --- Travel Rule check ---
  const amountUsd = Number(parsed.data.amount);
  if (isAboveTravelRuleThreshold(amountUsd) && !parsed.data.travelRule) {
    return NextResponse.json(
      { error: 'Travel Rule data required for transfers above threshold', requiresTravelRule: true },
      { status: 400 }
    );
  }

  const isScheduled = !!parsed.data.scheduledFor;

  // Create payment record
  const { data: payment, error: pErr } = await supabase
    .from('payments')
    .insert({
      user_id: session.user.id,
      direction: 'sent',
      from_wallet_id: parsed.data.fromWalletId,
      from_address: null,
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

  // --- Submit Travel Rule data if applicable ---
  if (parsed.data.travelRule && isAboveTravelRuleThreshold(amountUsd)) {
    try {
      await createTravelRuleTransfer(session.user.id, payment.id, {
        direction: 'outgoing',
        amountUsd,
        originatorName: parsed.data.travelRule.originatorName,
        originatorAddress: parsed.data.travelRule.originatorAddress,
        originatorWallet: payment.from_address ?? '',
        originatorChain: parsed.data.chain,
        beneficiaryName: parsed.data.travelRule.beneficiaryName,
        beneficiaryAddress: parsed.data.travelRule.beneficiaryAddress,
        beneficiaryWallet: parsed.data.toAddress,
        beneficiaryChain: parsed.data.chain,
        beneficiaryVasp: parsed.data.travelRule.beneficiaryVasp,
      });
    } catch (err) {
      console.error('[TravelRule] Submission failed:', err);
      // Non-blocking: payment proceeds, travel rule recorded as failed
    }
  }

  // Execute immediately if not scheduled
  if (!isScheduled) {
    const result = await executePayment(payment);
    return NextResponse.json({ data: { ...payment, ...result } });
  }

  return NextResponse.json({ data: payment }, { status: 201 });
}
