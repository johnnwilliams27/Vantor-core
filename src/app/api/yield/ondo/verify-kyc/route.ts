import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

// Import the shared viem client from yield rates
import { ethereumClient } from '@/lib/yield/rates/client';

// USDY token contract — has an allowlist for transfers
const USDY_TOKEN = '0x96F6eF951840721AdBF46Ac996b59E0235CB985C' as const;

const allowlistAbi = [
  {
    name: 'isAllowed',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

const schema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('verify Ondo KYC'); throw e; }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });

  const { walletAddress } = parsed.data;
  const enterpriseId = session.user.enterprise_id;
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  // Check on-chain allowlist
  let isAllowed = false;
  try {
    isAllowed = await ethereumClient.readContract({
      address: USDY_TOKEN,
      abi: allowlistAbi,
      functionName: 'isAllowed',
      args: [walletAddress as `0x${string}`],
    });
  } catch (err) {
    console.error('[ondo/verify-kyc] On-chain read failed:', err);
    return NextResponse.json({
      verified: false,
      message: 'Unable to verify on-chain allowlist. Please try again later.',
    });
  }

  const supabase = createAdminClient();

  if (isAllowed) {
    await supabase.from('ondo_kyc_verifications').upsert(
      {
        enterprise_id: enterpriseId,
        wallet_address: walletAddress.toLowerCase(),
        status: 'verified',
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'enterprise_id,wallet_address' },
    );

    return NextResponse.json({ verified: true });
  }

  // Not whitelisted yet — save as pending
  await supabase.from('ondo_kyc_verifications').upsert(
    {
      enterprise_id: enterpriseId,
      wallet_address: walletAddress.toLowerCase(),
      status: 'pending',
    },
    { onConflict: 'enterprise_id,wallet_address' },
  );

  return NextResponse.json({
    verified: false,
    message: 'Your wallet is not yet whitelisted by Ondo. It may take time for Ondo to process your verification. Try again later.',
  });
}
