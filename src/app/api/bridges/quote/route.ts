import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { getBridgeAdapter } from '@/lib/bridges/factory';
import { getBridgeProviderForToken } from '@/lib/bridges/interface';
import { writeAuditLog } from '@/lib/audit/logger';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { z } from 'zod';

const schema = z.object({
  token: z.enum(['USDC', 'USDT', 'PYUSD']),
  amount: z.string().min(1).max(50).refine((v) => parseFloat(v) > 0, 'Must be positive'),
  fromChain: z.enum(['ethereum', 'solana']),
  toChain: z.enum(['ethereum', 'solana']),
  walletAddress: z.string().min(1).max(100),
}).refine((d) => d.fromChain !== d.toChain, {
  message: 'Source and destination chains must differ',
  path: ['toChain'],
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!checkRateLimit('bridge-quote', session.user.id, 30, 3600_000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { token, amount, fromChain, toChain, walletAddress } = parsed.data;
  const provider = getBridgeProviderForToken(token as any);
  const adapter = getBridgeAdapter(provider);

  try {
    const quote = await adapter.getQuote({
      token: token as any,
      amount,
      fromChain: fromChain as any,
      toChain: toChain as any,
      walletAddress,
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'swap_quote',
      entityType: 'bridge',
      details: { token, amount, fromChain, toChain, provider, bridgeFee: quote.bridgeFee },
    });

    return NextResponse.json({ data: quote });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
