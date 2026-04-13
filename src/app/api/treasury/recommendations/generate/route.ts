import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getActiveTreasuryRule, computeRecommendation } from '@/lib/treasury/rules-engine';
import { generateTreasuryReasoning } from '@/lib/treasury/claude';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { decryptSlackCredentials, postRecommendationToSlack } from '@/lib/integrations/slack';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { NotificationService } from '@/lib/notifications/service';
import { recommendationEmailHtml } from '@/lib/notifications/recommendation-email';

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  // 10 AI recommendation generations per hour per user
  if (!checkRateLimit('treasury-recommend', session.user.id, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in an hour.' }, { status: 429 });
  }

  const supabase = createAdminClient();

  // 1. Get active rule
  const rule = await getActiveTreasuryRule(supabase, session.user.id, enterpriseId);
  if (!rule) {
    return NextResponse.json(
      { error: 'No active treasury rule configured. Please create a rule first.' },
      { status: 422 }
    );
  }

  // 2. Compute recommendation
  const result = await computeRecommendation(supabase, session.user.id, rule, enterpriseId);

  // 3. Generate AI reasoning
  const { reasoning, model } = await generateTreasuryReasoning({
    ...result,
    ruleLabel: rule.label,
    approvalThresholdUsd: parseFloat(rule.approval_threshold_usd),
  });

  // 4. Determine status
  const requiresApproval =
    result.action !== 'no_action' &&
    result.recommendedAmountUsd !== null &&
    result.recommendedAmountUsd >= parseFloat(rule.approval_threshold_usd);

  // INVARIANT: AI-initiated money movement never auto-executes. Every
  // non-no_action rec lands in 'pending_approval' and must be approved
  // by a human (web UI or Slack) — approval paths run the policy gate.
  // no_action is a terminal state because there's nothing to execute.

  // 5. Insert recommendation record
  const { data: rec, error: insertErr } = await supabase
    .from('ai_recommendations')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      treasury_rule_id: rule.id,
      total_bank_balance_usd: result.snapshot.totalBankBalanceUsd,
      total_crypto_balance_usd: result.snapshot.totalCryptoBalanceUsd,
      obligations_in_window_usd: result.totalObligationsUsd,
      safety_buffer_target_usd: result.safetyBufferTargetUsd,
      obligation_lookahead_days: result.lookaheadDays,
      action: result.action,
      recommended_amount_usd: result.recommendedAmountUsd,
      bank_account_id: result.targetBankAccountId,
      stablecoin_token: result.targetStablecoinToken,
      stablecoin_chain: result.targetChain,
      ai_reasoning: reasoning,
      ai_model: model,
      status: result.action === 'no_action' ? 'auto_executed' : 'pending_approval',
      requires_approval: requiresApproval,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  // Non-blocking Slack notification — never fail the request if Slack is down
  if (requiresApproval) {
    (async () => {
      try {
        const { data: slackIntegration } = await supabase
          .from('slack_integrations')
          .select('id, channel_id, credentials')
          .eq('user_id', session.user.id)
          .eq('enterprise_id', enterpriseId)
          .eq('is_active', true)
          .maybeSingle();

        if (slackIntegration) {
          const creds = await decryptSlackCredentials(slackIntegration.credentials, `slack_integrations/id=${slackIntegration.id}`);
          await postRecommendationToSlack(creds.botToken, slackIntegration.channel_id, {
            id: rec.id,
            action: result.action,
            recommendedAmountUsd: result.recommendedAmountUsd,
            stablecoinToken: result.targetStablecoinToken ?? null,
            stablecoinChain: result.targetChain ?? null,
            aiReasoning: reasoning,
          });
          await writeAuditLog({
            userId: session.user.id,
            action: 'slack_recommendation_notify',
            entityType: 'ai_recommendation',
            entityId: rec.id,
            details: { channel_id: slackIntegration.channel_id },
          });
        }
      } catch {
        // Silently ignore Slack errors
      }
    })();
  }

  await writeAuditLog({
    userId: session.user.id,
    action: 'treasury_recommendation_generate',
    entityType: 'ai_recommendation',
    entityId: rec.id,
    details: {
      action: result.action,
      recommended_amount_usd: result.recommendedAmountUsd,
      requires_approval: requiresApproval,
    },
  });

  // Notify — non-blocking
  const emailHtml = recommendationEmailHtml({
    id: rec.id,
    action: result.action,
    recommendedAmountUsd: rec.recommended_amount_usd,
    totalBankBalanceUsd: rec.total_bank_balance_usd,
    obligationsInWindowUsd: rec.obligations_in_window_usd,
    safetyBufferTargetUsd: rec.safety_buffer_target_usd,
    obligationLookaheadDays: rec.obligation_lookahead_days,
    aiReasoning: reasoning,
    stablecoinToken: rec.stablecoin_token,
    stablecoinChain: rec.stablecoin_chain,
    bankLabel: 'Bank Account',
    walletLabel: 'Wallet',
    status: rec.status,
    expiresAt: rec.expires_at,
  });

  // Notification branches on whether there's anything to approve. Every
  // non-no_action rec is pending_approval post-autoexec-removal, so the
  // "pending" branch fires for any actionable rec. no_action recs slot
  // into the auto_executed status with no follow-up needed.
  const isActionable = result.action !== 'no_action';
  await NotificationService.notify({
    eventType: isActionable ? 'recommendation_pending' : 'recommendation_auto_executed',
    enterpriseId: session.user.enterprise_id!,
    title: isActionable ? 'New AI Recommendation — Approval Required' : 'AI Recommendation Auto-Executed',
    body: `${result.action === 'onramp' ? 'On-ramp' : result.action === 'offramp' ? 'Off-ramp' : 'No action'} ${result.recommendedAmountUsd ? '$' + Math.round(result.recommendedAmountUsd).toLocaleString() : ''}`,
    link: isActionable ? `/treasury?reviewRec=${rec.id}` : '/treasury',
    metadata: {
      recommendationId: rec.id,
      action: result.action,
      amount: result.recommendedAmountUsd,
      _emailSubject: isActionable ? 'Action Required: New AI Recommendation' : 'AI Recommendation Auto-Executed',
      _emailHtml: emailHtml,
    },
    actorId: session.user.id,
  }).catch(() => {});

  return NextResponse.json({ data: rec }, { status: 201 });
}
