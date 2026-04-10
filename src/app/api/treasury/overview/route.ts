import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import {
  getActiveTreasuryRule,
  buildTreasurySnapshot,
  collectObligations,
} from '@/lib/treasury/rules-engine';
import { getStablecoinPrices } from '@/lib/treasury/oracle';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const supabase = createAdminClient();

  try {
    const { prices, source: priceSource } = await getStablecoinPrices();
    const snapshot = await buildTreasurySnapshot(supabase, session.user.id, prices, enterpriseId);

    // Load active treasury rule for health analysis
    const rule = await getActiveTreasuryRule(supabase, session.user.id, enterpriseId);

    let healthAnalysis = null;
    if (rule) {
      const obligations = await collectObligations(
        supabase,
        session.user.id,
        rule.obligation_lookahead_days,
        enterpriseId,
      );
      const totalObligationsUsd = obligations.reduce((s, o) => s + o.amountUsd, 0);
      const multiplier = parseFloat(rule.safety_buffer_multiplier);
      const safetyBufferTargetUsd = totalObligationsUsd * multiplier;
      const surplusUsd = snapshot.totalBankBalanceUsd - safetyBufferTargetUsd;

      // Determine health status
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      let signal: 'surplus' | 'shortage' | 'balanced' = 'balanced';

      if (surplusUsd > 100) {
        signal = 'surplus';
      } else if (surplusUsd < -100) {
        signal = 'shortage';
        status = surplusUsd < -1000 ? 'critical' : 'warning';
      }

      // Nearest obligation
      const sortedObligations = [...obligations].sort(
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
      );

      healthAnalysis = {
        status,
        signal,
        totalObligationsUsd,
        safetyBufferTargetUsd,
        surplusUsd,
        lookaheadDays: rule.obligation_lookahead_days,
        obligationCount: obligations.length,
        nearestObligation: sortedObligations[0] ?? null,
        ruleLabel: rule.label,
      };
    }

    // Pending recommendations
    const { data: pendingRecs } = await supabase
      .from('ai_recommendations')
      .select('id, action, recommended_amount_usd, status, expires_at, created_at')
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
      .eq('status', 'pending_approval')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    // Last recommendation timestamp
    const { data: lastRec } = await supabase
      .from('ai_recommendations')
      .select('created_at')
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      data: {
        ...snapshot,
        priceSource,
        healthAnalysis,
        lastRecommendationAt: lastRec?.created_at ?? null,
        pendingRecommendations: pendingRecs ?? [],
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
