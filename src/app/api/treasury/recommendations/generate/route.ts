import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getActiveTreasuryRule, computeRecommendation } from '@/lib/treasury/rules-engine';
import { generateTreasuryReasoning } from '@/lib/treasury/claude';
import { getBankingAdapter } from '@/lib/banking/factory';
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

  const willAutoExecute = result.action !== 'no_action' && !requiresApproval;

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
      status: willAutoExecute ? 'auto_executed' : (result.action === 'no_action' ? 'auto_executed' : 'pending_approval'),
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
          .select('channel_id, credentials')
          .eq('user_id', session.user.id)
          .eq('enterprise_id', enterpriseId)
          .eq('is_active', true)
          .maybeSingle();

        if (slackIntegration) {
          const creds = decryptSlackCredentials(slackIntegration.credentials);
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

  await NotificationService.notify({
    eventType: requiresApproval ? 'recommendation_pending' : 'recommendation_auto_executed',
    enterpriseId: session.user.enterprise_id!,
    title: requiresApproval ? 'New AI Recommendation — Approval Required' : 'AI Recommendation Auto-Executed',
    body: `${result.action === 'onramp' ? 'On-ramp' : result.action === 'offramp' ? 'Off-ramp' : 'No action'} ${result.recommendedAmountUsd ? '$' + Math.round(result.recommendedAmountUsd).toLocaleString() : ''}`,
    link: requiresApproval ? `/treasury?reviewRec=${rec.id}` : '/treasury',
    metadata: {
      recommendationId: rec.id,
      action: result.action,
      amount: result.recommendedAmountUsd,
      _emailSubject: requiresApproval ? 'Action Required: New AI Recommendation' : 'AI Recommendation Auto-Executed',
      _emailHtml: emailHtml,
    },
    actorId: session.user.id,
  }).catch(() => {});

  // 6. Auto-execute if below threshold and action is not no_action
  if (willAutoExecute && result.action !== 'no_action' && result.recommendedAmountUsd) {
    try {
      const adapter = getBankingAdapter();
      const rampResult = await adapter.executeRamp({
        direction: result.action,
        cryptoToken: result.targetStablecoinToken,
        cryptoAmount: result.recommendedAmountUsd,
        fiatAmount: result.recommendedAmountUsd,
        fiatCurrency: 'USD',
        exchangeRate: 1,
        feeAmount: 0,
        bankAccountRef: result.targetBankAccountId ?? undefined,
      });

      const { data: fiatTx } = await supabase
        .from('fiat_transactions')
        .insert({
          user_id: session.user.id,
          enterprise_id: enterpriseId,
          bank_account_id: result.targetBankAccountId,
          direction: result.action,
          crypto_amount: result.recommendedAmountUsd,
          crypto_token: result.targetStablecoinToken,
          fiat_amount: result.recommendedAmountUsd,
          fiat_currency: 'USD',
          exchange_rate: 1,
          fee_amount: 0,
          status: rampResult.status,
          provider: 'bridge',
          provider_transaction_id: rampResult.providerTransactionId,
          settled_at: rampResult.settledAt,
        })
        .select()
        .single();

      await supabase
        .from('ai_recommendations')
        .update({
          status: 'auto_executed',
          executed_at: new Date().toISOString(),
          fiat_transaction_id: fiatTx?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rec.id);

      await writeAuditLog({
        userId: session.user.id,
        action: 'treasury_recommendation_execute',
        entityType: 'ai_recommendation',
        entityId: rec.id,
        details: {
          provider_tx_id: rampResult.providerTransactionId,
          auto_executed: true,
        },
      });

      return NextResponse.json({ data: { ...rec, status: 'auto_executed' } }, { status: 201 });
    } catch (execErr) {
      await supabase
        .from('ai_recommendations')
        .update({
          execution_error: (execErr as Error).message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rec.id);

      return NextResponse.json(
        { data: rec, warning: 'Auto-execution failed: ' + (execErr as Error).message },
        { status: 201 }
      );
    }
  }

  return NextResponse.json({ data: rec }, { status: 201 });
}
