import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { getJupiterQuote } from '@/lib/swaps/jupiter';
import { getOneInchQuote } from '@/lib/swaps/oneinch';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import type { TokenSymbol } from '@/types/database';

const schema = z.object({
  chain: z.enum(['ethereum', 'solana']),
  fromToken: z.enum(['USDC', 'USDT', 'PYUSD']),
  toToken: z.enum(['USDC', 'USDT', 'PYUSD']),
  amount: z.string(),
  slippageBps: z.number().optional(),
  walletAddress: z.string(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { chain, fromToken, toToken, amount, slippageBps, walletAddress } = parsed.data;

  let quote;
  try {
    if (chain === 'solana') {
      quote = await getJupiterQuote(fromToken as TokenSymbol, toToken as TokenSymbol, amount, slippageBps);
    } else {
      quote = await getOneInchQuote(fromToken as TokenSymbol, toToken as TokenSymbol, amount, walletAddress, slippageBps);
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  await writeAuditLog({
    userId: session.user.id,
    action: 'swap_quote',
    details: { chain, fromToken, toToken, amount },
  });

  return NextResponse.json({ data: quote });
}
