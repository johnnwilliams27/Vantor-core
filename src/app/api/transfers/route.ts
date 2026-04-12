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
import {
  PolicyGateService,
  mapTransferToMovement,
  GateError,
  mapGateErrorToHttp,
  type GateActor,
} from '@/lib/policy/gate';
import { buildProductionEvaluate } from '@/lib/policy/gate/production-wiring';
import { ApprovalWorkflowService } from '@/lib/policy/approvals';

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
    .select('id, chain, address')
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

  // ─── Policy gate + approval workflow integration ──────────────────
  //
  // Build the movement (pure, generates a fresh UUID). transfer.id =
  // movement.id so the approval request can reference the transfer by
  // its PK.
  const movement = mapTransferToMovement(
    {
      fromWalletId: parsed.data.fromWalletId,
      toAddress: parsed.data.toAddress,
      chain: parsed.data.chain,
      token: parsed.data.token,
      amount: parsed.data.amount,
      memo: parsed.data.memo,
      counterpartyId: parsed.data.counterpartyId,
    },
    {
      userId: session.user.id,
      enterpriseId: enterpriseId as string,
      fromAddress: (wallet as { address?: string }).address ?? '',
    },
  );

  // Defensive insert: status='awaiting_approval' first. Flipped to 'pending'
  // on allow_auto, or to 'denied' on gate throw. No signable row exists
  // until the gate confirms it should.
  const { data: transfer, error: pErr } = await supabase
    .from('transfers')
    .insert({
      id: movement.id,
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
      status: 'awaiting_approval',
    })
    .select()
    .single();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  // Build + run the gate.
  const gateService = new PolicyGateService(supabase, {
    evaluate: buildProductionEvaluate(supabase),
    approvalService: new ApprovalWorkflowService(supabase),
  });

  const actor: GateActor = {
    user_id: session.user.id,
    role: session.user.role as GateActor['role'],
    enterprise_id: enterpriseId as string,
  };

  let gateResult;
  try {
    gateResult = await gateService.gate(movement, actor);
  } catch (err) {
    if (err instanceof GateError) {
      // Rollback path: flip transfer to denied with the reason code.
      await supabase
        .from('transfers')
        .update({ status: 'denied', denial_reason: err.reason_code })
        .eq('id', transfer.id);

      await writeAuditLog({
        userId: session.user.id,
        action: 'transfer_create_blocked',
        entityType: 'transfer',
        entityId: transfer.id,
        details: {
          reason_code: err.reason_code,
          trace: (err.details as Record<string, unknown>)?.trace ?? undefined,
        },
      });

      const { status, body } = mapGateErrorToHttp(err);
      return NextResponse.json(body, { status });
    }
    // Unexpected error — rethrow so Next.js error boundary handles it.
    throw err;
  }

  if (gateResult.verdict === 'allow_auto') {
    await supabase
      .from('transfers')
      .update({ status: 'pending' })
      .eq('id', transfer.id);

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

    return NextResponse.json(
      { data: { ...transfer, status: 'pending' } },
      { status: 201 },
    );
  }

  // require_approval — transfer stays 'awaiting_approval', approval_request
  // already created by the gate.
  await writeAuditLog({
    userId: session.user.id,
    action: 'transfer_create_requires_approval',
    entityType: 'transfer',
    entityId: transfer.id,
    details: {
      approval_request_id: gateResult.approval_request.id,
      chain_id: gateResult.approval_request.chain_id,
      chain_name: gateResult.evaluation.required_chain?.chain_name,
    },
  });

  return NextResponse.json(
    {
      data: { ...transfer, status: 'awaiting_approval' },
      approval_request: gateResult.approval_request,
    },
    { status: 202 },
  );
}
