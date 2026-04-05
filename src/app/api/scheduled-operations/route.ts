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

  // Validate type-specific params
  let validatedParams: Record<string, unknown>;
  if (type === 'swap') {
    const result = swapParamsSchema.safeParse(params);
    if (!result.success) {
      return NextResponse.json({ error: 'Invalid swap params', details: result.error.issues }, { status: 400 });
    }
    validatedParams = result.data;
  } else if (type === 'bridge') {
    const result = bridgeParamsSchema.safeParse(params);
    if (!result.success) {
      return NextResponse.json({ error: 'Invalid bridge params', details: result.error.issues }, { status: 400 });
    }
    validatedParams = result.data;
  } else {
    const result = rampParamsSchema.safeParse(params);
    if (!result.success) {
      return NextResponse.json({ error: 'Invalid ramp params', details: result.error.issues }, { status: 400 });
    }
    validatedParams = result.data;
  }

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

  const { data: op, error: insertErr } = await supabase
    .from('scheduled_operations')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      type,
      status: 'pending',
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

  return NextResponse.json({ data: op, initialQuote, toleranceBps }, { status: 201 });
}
