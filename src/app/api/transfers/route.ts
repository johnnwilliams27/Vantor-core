import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { screenAddressWithCache } from '@/lib/compliance/screening';
import { checkTransferEligibility } from '@/lib/sanctions/eligibility';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';

const PAYMENT_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;

const schema = z.object({
  fromWalletId: z.string().uuid(),
  toAddress: z.string().min(32).max(100),
  chain: z.enum(['ethereum', 'solana']),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().max(50),
  memo: z.string().max(2000).optional(),
  invoiceId: z.string().uuid().optional(),
  erpConfigId: z.string().uuid().optional(),
  scheduledFor: z.string().datetime().optional(),
  counterpartyId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get('status');
  const status = rawStatus && (PAYMENT_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : null;
  const supabase = createAdminClient();

  // Try with ERP join (requires erp_config_id column migration to have run)
  let q = supabase
    .from('transfers')
    .select('*, from_wallet:wallets(*), invoice:invoices(*), erp_config:erp_configurations(id, label, provider)')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  let { data, error } = await q;

  if (error) {
    // Column not yet migrated — fall back to query without ERP join
    let q2 = supabase
      .from('transfers')
      .select('*, from_wallet:wallets(*), invoice:invoices(*)')
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
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
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('create transfers'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

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
    .eq('enterprise_id', enterpriseId)
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

  // --- Counterparty eligibility check (OpenSanctions) ---
  if (parsed.data.counterpartyId && enterpriseId) {
    try {
      const eligibility = await checkTransferEligibility(
        parsed.data.counterpartyId,
        enterpriseId,
        session.user.id,
      );
      if (!eligibility.eligible) {
        return NextResponse.json(
          { error: `Transfer blocked: counterparty ${eligibility.reason}`, eligibility },
          { status: 403 },
        );
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Counterparty eligibility check failed: ${(err as Error).message}` },
        { status: 500 },
      );
    }
  }

  // Scheduled transfers are not supported yet — they require server-side signing
  // which we haven't implemented. Block them with a clear error.
  if (parsed.data.scheduledFor) {
    return NextResponse.json(
      { error: 'Scheduled transfers are not yet supported. Send the transfer immediately or check back soon.' },
      { status: 400 },
    );
  }

  // Create pending transfer record — the client will drive on-chain execution
  // via the user's connected wallet and call /api/transfers/confirm when done.
  const { data: transfer, error: pErr } = await supabase
    .from('transfers')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
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
      counterparty_id: parsed.data.counterpartyId ?? null,
      scheduled_for: null,
      status: 'pending',
    })
    .select()
    .single();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'transfer_create',
    entityType: 'transfer',
    entityId: transfer.id,
    details: {
      chain: transfer.chain,
      token: transfer.token,
      amount: transfer.amount,
    },
  });

  return NextResponse.json({ data: transfer }, { status: 201 });
}
