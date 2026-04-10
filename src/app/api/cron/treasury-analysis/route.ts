import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeRecommendation } from '@/lib/treasury/rules-engine';
import { generateTreasuryReasoning } from '@/lib/treasury/claude';
import { writeAuditLog } from '@/lib/audit/logger';
import { NotificationService } from '@/lib/notifications/service';
import { recommendationEmailHtml } from '@/lib/notifications/recommendation-email';
import { decryptSlackCredentials, postRecommendationToSlack } from '@/lib/integrations/slack';
import type { TreasuryRule } from '@/types/database';

const BATCH_SIZE = 50;

/**
 * Daily automated treasury analysis cron.
 * Runs recommendation generation for every enterprise with an active treasury rule.
 * Skips enterprises that already have a pending_approval recommendation (avoid spamming).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Exclude test enterprises
  const { data: testEnts } = await supabase
    .from('enterprises')
    .select('id')
    .eq('is_test_enterprise', true);
  const testEntIds = (testEnts ?? []).map((e) => e.id);

  // Get all active treasury rules (one per enterprise/user)
  let query = supabase
    .from('treasury_rules')
    .select('*, user_profiles!inner(id, enterprise_id, subscription_tier)')
    .eq('is_active', true)
    .limit(BATCH_SIZE);

  if (testEntIds.length > 0) {
    query = query.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
  }

  const { data: rules, error } = await query;

  if (error) {
    console.error('[cron/treasury-analysis]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!rules?.length) {
    return NextResponse.json({ processed: 0, message: 'No active treasury rules found' });
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const ruleRow of rules) {
    const rule = ruleRow as TreasuryRule & {
      user_profiles: { id: string; enterprise_id: string; subscription_tier: string };
    };
    const userId = rule.user_id;
    const enterpriseId = rule.user_profiles.enterprise_id;

    try {
      // Skip if there's already a pending recommendation for this enterprise
      const { data: existing } = await supabase
        .from('ai_recommendations')
        .select('id')
        .eq('enterprise_id', enterpriseId)
        .eq('status', 'pending_approval')
        .gt('expires_at', new Date().toISOString())
        .limit(1)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Compute recommendation
      const result = await computeRecommendation(supabase, userId, rule, enterpriseId);

      // Skip generating AI reasoning for no_action to save Claude API costs
      if (result.action === 'no_action') {
        skipped++;
        continue;
      }

      // Generate AI reasoning
      const { reasoning, model } = await generateTreasuryReasoning({
        ...result,
        ruleLabel: rule.label,
        approvalThresholdUsd: parseFloat(rule.approval_threshold_usd),
      });

      const requiresApproval =
        result.recommendedAmountUsd !== null &&
        result.recommendedAmountUsd >= parseFloat(rule.approval_threshold_usd);

      // Insert recommendation — cron-generated ones always require approval (no auto-execute)
      const { data: rec, error: insertErr } = await supabase
        .from('ai_recommendations')
        .insert({
          user_id: userId,
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
          status: 'pending_approval',
          requires_approval: true,
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`[cron/treasury-analysis] Insert failed for enterprise ${enterpriseId}:`, insertErr);
        failed++;
        continue;
      }

      await writeAuditLog({
        userId,
        enterpriseId,
        action: 'treasury_recommendation_generate',
        entityType: 'ai_recommendation',
        entityId: rec.id,
        details: {
          action: result.action,
          recommended_amount_usd: result.recommendedAmountUsd,
          requires_approval: true,
          source: 'cron',
        },
      });

      // Notify
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

      // Build Slack function — fires only if user has slack_enabled preference
      const slackFn = async () => {
        const { data: slackIntegration } = await supabase
          .from('slack_integrations')
          .select('channel_id, credentials')
          .eq('enterprise_id', enterpriseId)
          .eq('is_active', true)
          .maybeSingle();

        if (!slackIntegration) return;

        const creds = decryptSlackCredentials(slackIntegration.credentials);
        await postRecommendationToSlack(
          creds.botToken,
          slackIntegration.channel_id,
          {
            id: rec.id,
            action: result.action,
            recommendedAmountUsd: result.recommendedAmountUsd,
            stablecoinToken: result.targetStablecoinToken ?? null,
            stablecoinChain: result.targetChain ?? null,
            aiReasoning: reasoning,
          },
        );

        await writeAuditLog({
          userId,
          enterpriseId,
          action: 'slack_recommendation_notify',
          entityType: 'ai_recommendation',
          entityId: rec.id,
          details: { channel_id: slackIntegration.channel_id, source: 'cron' },
        });
      };

      await NotificationService.notify({
        eventType: 'recommendation_daily',
        enterpriseId,
        title: 'Daily AI Recommendation — Approval Required',
        body: `${result.action === 'onramp' ? 'On-ramp' : 'Off-ramp'} $${Math.round(result.recommendedAmountUsd ?? 0).toLocaleString()}`,
        link: `/treasury?reviewRec=${rec.id}`,
        metadata: {
          recommendationId: rec.id,
          action: result.action,
          amount: result.recommendedAmountUsd,
          source: 'cron',
          _emailSubject: 'Daily AI Recommendation — Approval Required',
          _emailHtml: emailHtml,
          _slackFn: slackFn,
        },
        actorId: userId,
      }).catch(() => {});

      generated++;
    } catch (err) {
      console.error(`[cron/treasury-analysis] Failed for enterprise ${enterpriseId}:`, err);
      failed++;
    }
  }

  console.log(
    `[cron/treasury-analysis] generated=${generated} skipped=${skipped} failed=${failed}`,
  );

  return NextResponse.json({ generated, skipped, failed });
}
