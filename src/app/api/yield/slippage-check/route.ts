import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { getLiquidityProvider, calculateSlippage } from '@/lib/yield/slippage';
import type { ChainType, TokenSymbol } from '@/types/database';
import type { YieldProtocolId } from '@/lib/yield/interface';
import { z } from 'zod';

const schema = z.object({
  protocol: z.enum(['aave_v3', 'morpho_reservoir', 'morpho_steakhouse', 'kamino', 'kamino_multiply', 'ondo', 'sky', 'ethena']),
  token: z.enum(['USDC', 'USDT']),
  chain: z.enum(['ethereum', 'solana']),
  amountUsd: z.number().positive('Amount must be positive'),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { protocol, token, chain, amountUsd } = parsed.data;

  try {
    const provider = getLiquidityProvider();
    const poolLiquidity = await provider.getPoolLiquidity(
      protocol as YieldProtocolId,
      chain as ChainType,
      token as TokenSymbol,
    );

    const estimate = calculateSlippage(amountUsd, poolLiquidity);

    return NextResponse.json({ data: estimate });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to check slippage' },
      { status: 500 },
    );
  }
}
