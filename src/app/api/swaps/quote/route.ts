import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { writeAuditLog } from '@/lib/audit/logger';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { isTestMode } from '@/lib/test-mode/helpers';
import { calculateVantorFee } from '@/lib/billing/usage';
import { z } from 'zod';

const schema = z.object({
  chain: z.enum(['ethereum', 'solana']),
  fromToken: z.enum(['USDC', 'USDT']),
  toToken: z.enum(['USDC', 'USDT']),
  amount: z.string().max(50),
  slippageBps: z.number().int().min(0).max(10000).optional(),
  walletAddress: z.string().min(32).max(100),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!checkRateLimit('swaps-quote', session.user.id, 30, 60 * 60 * 1000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { chain, fromToken, toToken, amount, slippageBps, walletAddress } = parsed.data;

  try {
    const mode = getIntegrationMode(session.user.subscription_tier);
    const adapter = getBankingAdapter(mode);
    const quote = await adapter.getSwapQuote({
      chain: chain as any,
      fromToken: fromToken as any,
      toToken: toToken as any,
      amount,
      slippageBps,
      walletAddress,
    });

    const testMode = isTestMode();
    const vantorFee = testMode ? 0 : calculateVantorFee(parseFloat(quote.fromAmount));

    await writeAuditLog({
      userId: session.user.id,
      action: 'swap_quote',
      details: { chain, fromToken, toToken, amount, provider: 'bridge' },
    });

    return NextResponse.json({ data: { ...quote, vantor_fee: vantorFee } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
