import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const schema = z.object({
  chain: z.enum(['ethereum', 'solana']),
  address: z.string(),
  message: z.string(),
  signature: z.string(),
  label: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { chain, address, message, signature, label } = parsed.data;

  // Verify signature
  let verified = false;
  try {
    if (chain === 'solana') {
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = bs58.decode(signature);
      const pubKeyBytes = bs58.decode(address);
      verified = nacl.sign.detached.verify(msgBytes, sigBytes, pubKeyBytes);
    } else if (chain === 'ethereum') {
      // SIWE verification (simplified – production should use full SIWE library)
      const { verifyMessage } = await import('viem');
      verified = (await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      })) === true;
    }
  } catch (err) {
    console.error('[wallet-verify] sig error', err);
    verified = false;
  }

  if (!verified) {
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Upsert wallet
  const { data: wallet, error } = await supabase
    .from('wallets')
    .upsert(
      {
        user_id: session.user.id,
        chain,
        address,
        label: label ?? null,
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,chain,address', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAuditLog({
    userId: session.user.id,
    action: 'wallet_connect',
    entityType: 'wallet',
    entityId: wallet.id,
    details: { chain, address },
  });

  return NextResponse.json({ data: wallet });
}
