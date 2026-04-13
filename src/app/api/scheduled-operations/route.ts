import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getIntegrationMode, type IntegrationMode } from '@/lib/env/integration-mode';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { TOLERANCE_BPS } from '@/lib/scheduled-operations/tolerances';
import { z } from 'zod';
import type { ScheduledOperationType } from '@/types/scheduled-operations';
import {
  PolicyGateService,
  mapRampToMovement,
  mapScheduledOperationToMovement,
  GateError,
  mapGateErrorToHttp,
  type GateActor,
} from '@/lib/policy/gate';
import { buildProductionEvaluate } from '@/lib/policy/gate/production-wiring';
import { ApprovalWorkflowService } from '@/lib/policy/approvals';
import { randomUUID } from 'crypto';

const VALID_TYPES: ScheduledOperationType[] = ['swap', 'bridge', 'ramp'];
const VALID_STATUSES = ['pending', 'processing', 'awaiting_authorization', 'completed', 'failed', 'cancelled', 'expired'] as const;

// ---- Per-type param schemas ----

const swapParamsSchema = z.object({
  walletId: z.string().uuid(),
  chain: z.enum(['ethereum', 'solana']),
  fromToken: z.enum(['USDC', 'USDT']),
  toToken: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).max(50),
  slippageBps: z.number().int().optional(),
  walletAddress: z.string().min(32).max(100),
});

const bridgeParamsSchema = z.object({
  fromWalletId: z.string().uuid(),
  toWalletId: z.string().uuid(),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).max(50),
  fromChain: z.enum(['ethereum', 'solana']),
  toChain: z.enum(['ethereum', 'solana']),
  walletAddress: z.string().min(32).max(100),
});

const rampParamsSchema = z.object({
  direction: z.enum(['onramp', 'offramp']),
  cryptoToken: z.enum(['USDC', 'USDT']),
  fiatCurrency: z.string().min(3).max(10),
  cryptoAmount: z.number().positive(),
  fiatAmount: z.number().positive().optional(),
  bankAccountId: z.string().uuid(),
  walletId: z.string().uuid().optional(),
});

const bodySchema = z.object({
  type: z.enum(['swap', 'bridge', 'ramp']),
  scheduledFor: z.string().datetime(),
  memo: z.string().max(2000).optional(),
  params: z.record(z.unknown()),
});

// ---- Fetch initial quote by type ----

async function fetchInitialQuote(
  type: ScheduledOperationType,
  params: Record<string, unknown>,
  mode: IntegrationMode,
): Promise<Record<string, unknown>> {
  const adapter = getBankingAdapter(mode);

  switch (type) {
    case 'swap': {
      const p = params as z.infer<typeof swapParamsSchema>;
      const q = await adapter.getSwapQuote({
        chain: p.chain as any,
        fromToken: p.fromToken as any,
        toToken: p.toToken as any,
        amount: p.amount,
        slippageBps: p.slippageBps,
        walletAddress: p.walletAddress,
      });
      return q as unknown as Record<string, unknown>;
    }
    case 'bridge': {
      const p = params as z.infer<typeof bridgeParamsSchema>;
      const q = await adapter.getBridgeQuote({
        token: p.token as any,
        amount: p.amount,
        fromChain: p.fromChain as any,
        toChain: p.toChain as any,
        walletAddress: p.walletAddress,
      });
      return q as unknown as Record<string, unknown>;
    }
    case 'ramp': {
      const p = params as z.infer<typeof rampParamsSchema>;
      const q = await adapter.getRampQuote({
        direction: p.direction,
        cryptoToken: p.cryptoToken,
        fiatCurrency: p.fiatCurrency,
        cryptoAmount: p.cryptoAmount,
      });
      return q as unknown as Record<string, unknown>;
    }
  }
}

// ---- GET — list scheduled operations (requires accountant+) ----

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const { searchParams } = new URL(req.url);
  const rawType = searchParams.get('type');
  const rawStatus = searchParams.get('status');

  const type = rawType && (VALID_TYPES as string[]).includes(rawType) ? rawType : null;
  const status = rawStatus && (VALID_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : null;

  const supabase = createAdminClient();

  let q = supabase
    .from('scheduled_operations')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (type) q = q.eq('type', type);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// ---- POST — create scheduled operation (requires treasury_manager) ----

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  const { type, scheduledFor, memo, params } = parsed.data;

  // Swaps and bridges are temporarily disabled at the product level —
  // Bridge.xyz does not offer a swap or cross-chain primitive, and the
  // replacement DEX / bridging adapters are still being designed. See
  // /api/swaps/quote and /api/bridges/quote for the full explanation.
  // Reject at the scheduling layer too so users don't queue operations
  // that will silently fail at execution time.
  if (type === 'swap') {
    return NextResponse.json(
      {
        error: 'swaps_disabled',
        message: 'Stablecoin swaps are temporarily disabled while we integrate a dedicated DEX aggregator.',
      },
      { status: 501 },
    );
  }
  if (type === 'bridge') {
    return NextResponse.json(
      {
        error: 'bridges_disabled',
        message: 'Cross-chain bridging is temporarily disabled while we integrate a dedicated bridging provider.',
      },
      { status: 501 },
    );
  }

  // After the swap/bridge gates above, `type` is narrowed to 'ramp' — the
  // other param branches are intentionally removed as dead code. The
  // swap/bridge zod schemas (swapParamsSchema / bridgeParamsSchema) are kept
  // in this file so re-enabling is a one-line revert once the replacement
  // adapters land.
  const rampResult = rampParamsSchema.safeParse(params);
  if (!rampResult.success) {
    return NextResponse.json({ error: 'Invalid ramp params', details: rampResult.error.issues }, { status: 400 });
  }
  const validatedParams: Record<string, unknown> = rampResult.data;

  // Fetch initial quote
  const mode = getIntegrationMode(session.user.subscription_tier);
  let initialQuote: Record<string, unknown>;
  try {
    initialQuote = await fetchInitialQuote(type, validatedParams, mode);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch initial quote: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const toleranceBps = TOLERANCE_BPS[type];
  const supabase = createAdminClient();

  // ─── Policy gate at creation ───────────────────────────────────────
  // Gate runs at schedule time so a policy-blocked operation never sits
  // queued, and a require_approval operation needs an approver click
  // before the cron can pick it up.
  //
  // NOTE: the cron executor currently does NOT re-gate at execution time.
  // If policy state changes between schedule and execution (e.g., balances
  // drop, sanctions update), the scheduled op still runs. Re-gating at
  // execution is a documented follow-up (see project memory).
  //
  // Scope note: only 'ramp' reaches here — swap/bridge are 501-gated above.
  // We still build a movement + gate it; adding swap/bridge later is a
  // switch branch per type, reusing the same scaffolding.
  const opId = randomUUID();

  // Build the inner movement from ramp params.
  const r = validatedParams as z.infer<typeof rampParamsSchema>;
  const { data: userWallet } = await supabase
    .from('wallets')
    .select('id, address')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .limit(1)
    .maybeSingle();
  const innerMovement = mapRampToMovement(
    {
      direction: r.direction,
      cryptoToken: r.cryptoToken,
      cryptoAmount: String(r.cryptoAmount),
      fiatCurrency: r.fiatCurrency,
      ...(r.fiatAmount !== undefined ? { fiatAmount: String(r.fiatAmount) } : {}),
      bankAccountId: r.bankAccountId,
      ...(userWallet?.address ? { walletAddress: userWallet.address } : {}),
    },
    { userId: session.user.id, enterpriseId: enterpriseId as string, fromAddress: userWallet?.address ?? '' },
  );
  const movement = mapScheduledOperationToMovement(
    { scheduledOpId: opId, type, inner: innerMovement },
    { userId: session.user.id, enterpriseId: enterpriseId as string, fromAddress: userWallet?.address ?? '' },
  );

  const { data: op, error: insertErr } = await supabase
    .from('scheduled_operations')
    .insert({
      id: opId,
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      type,
      status: 'awaiting_approval',
      scheduled_for: scheduledFor,
      params: validatedParams,
      initial_quote: initialQuote,
      execution_quote: null,
      deviation_bps: null,
      tolerance_bps: toleranceBps,
      memo: memo ?? null,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

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
      await supabase
        .from('scheduled_operations')
        .update({ status: 'denied', denial_reason: err.reason_code })
        .eq('id', op.id)
        .eq('enterprise_id', enterpriseId as string);
      await writeAuditLog({
        userId: session.user.id,
        action: 'scheduled_operation_blocked' as any,
        entityType: 'scheduled_operation',
        entityId: op.id,
        details: { reason_code: err.reason_code, type, ...(err.details as Record<string, unknown>) },
      });
      const { status, body } = mapGateErrorToHttp(err);
      return NextResponse.json(body, { status });
    }
    throw err;
  }

  if (gateResult.verdict === 'require_approval') {
    await writeAuditLog({
      userId: session.user.id,
      action: 'scheduled_operation_requires_approval' as any,
      entityType: 'scheduled_operation',
      entityId: op.id,
      details: {
        approval_request_id: gateResult.approval_request.id,
        chain_id: gateResult.approval_request.chain_id,
        type,
        scheduledFor,
      },
    });
    return NextResponse.json(
      { data: op, initialQuote, toleranceBps, approval_request: gateResult.approval_request },
      { status: 202 },
    );
  }

  // allow_auto: flip to 'pending' so the cron executor picks it up at
  // scheduled_for. Any conditional-update race is harmless here since the
  // cron runs against status='pending' AND scheduled_for <= now().
  const { data: flipped, error: flipErr } = await supabase
    .from('scheduled_operations')
    .update({ status: 'pending' })
    .eq('id', op.id)
    .eq('enterprise_id', enterpriseId as string)
    .select()
    .single();
  if (flipErr) {
    await supabase
      .from('scheduled_operations')
      .update({ status: 'denied', denial_reason: 'gate_update_failed' })
      .eq('id', op.id)
      .eq('enterprise_id', enterpriseId as string);
    return NextResponse.json(
      {
        reason_code: 'gate_update_failed',
        human_readable: 'Policy gate cleared the scheduled operation but the status flip failed.',
        user_action: 'Retry the schedule request.',
        details: { scheduled_op_id: op.id },
      },
      { status: 500 },
    );
  }

  await writeAuditLog({
    userId: session.user.id,
    action: 'scheduled_operation_create' as any,
    entityType: 'scheduled_operation',
    entityId: op.id,
    details: {
      type,
      scheduledFor,
      tolerance_bps: toleranceBps,
    },
  });

  return NextResponse.json({ data: flipped ?? op, initialQuote, toleranceBps }, { status: 201 });
}
