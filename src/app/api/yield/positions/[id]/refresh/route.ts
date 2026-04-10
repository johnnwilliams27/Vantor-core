import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getYieldAdapter, getOnChainValue } from '@/lib/yield/factory';
import { computeAccruedYield } from '@/lib/yield/position-accounting';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!checkRateLimit('yield-refresh', session.user.id, 20, 3600_000)) {
    return rateLimitResponse();
  }

  const supabase = createAdminClient();
  const { data: position, error } = await supabase
    .from('yield_positions')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (error || !position) {
    return NextResponse.json({ error: 'Position not found' }, { status: 404 });
  }

  // Get wallet address from wallets table
  let walletAddress = 'mock-wallet';
  if (position.wallet_id) {
    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('id', position.wallet_id)
      .single();
    if (wallet) walletAddress = wallet.address;
  }

  const adapter = getYieldAdapter(position.protocol as YieldProtocolId);
  const rate = await adapter.getAPY(position.underlying_token as TokenSymbol);

  // Get current on-chain value
  const onChain = await getOnChainValue(
    position.protocol as YieldProtocolId,
    walletAddress,
    position.underlying_token as TokenSymbol,
    parseFloat(position.current_value_usd),
    parseFloat(position.yield_token_balance || '0'),
  );

  const currentValue = onChain.currentValueUsd;
  const depositedAmount = parseFloat(position.deposited_amount);
  const accruedYield = computeAccruedYield(currentValue, depositedAmount);

  const updatedFields = {
    current_value_usd: currentValue,
    accrued_yield_usd: accruedYield,
    yield_token_balance: onChain.yieldTokenBalance,
    apy_snapshot: rate.totalAPY,
    last_refreshed_at: new Date().toISOString(),
  };

  const { data: updated, error: updateErr } = await supabase
    .from('yield_positions')
    .update(updatedFields)
    .eq('id', params.id)
    .select()
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'yield_position_refresh',
    entityType: 'yield_position',
    entityId: params.id,
    details: { protocol: position.protocol, apy: rate.totalAPY },
  });

  return NextResponse.json({ data: updated });
}
