import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import {
  decryptSlackCredentials,
  verifySlackSignature,
  updateSlackMessage,
  postEphemeralConfirmation,
  postScheduledOpConfirmation,
} from '@/lib/integrations/slack';
import { getBankingAdapter } from '@/lib/banking/factory';
import { updateBalancesAfterRamp } from '@/lib/balances/update-after-movement';
import {
  PolicyGateService,
  mapRecommendationToMovement,
  GateError,
  type GateActor,
} from '@/lib/policy/gate';
import { buildProductionEvaluate } from '@/lib/policy/gate/production-wiring';
import { ApprovalWorkflowService } from '@/lib/policy/approvals';
// No session available in Slack callback — authenticated via HMAC; always use live mode

// No session auth — authenticated via Slack HMAC signature verification

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const timestamp = req.headers.get('x-slack-request-timestamp') ?? '';
  const slackSignature = req.headers.get('x-slack-signature') ?? '';

  // Parse URL-encoded payload from Slack
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get('payload');
  if (!payloadStr) {
    return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
  }

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadStr) as SlackInteractionPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid payload JSON' }, { status: 400 });
  }

  const teamId = payload.team?.id;
  const channelId = payload.container?.channel_id ?? payload.actions?.[0]?.value;
  const supabase = createAdminClient();

  // Look up integration — try team_id first, then fall back to channel_id
  let integration: { id: string; user_id: string; enterprise_id: string; channel_id: string; credentials: string } | null = null;

  if (teamId) {
    const { data } = await supabase
      .from('slack_integrations')
      .select('id, user_id, enterprise_id, channel_id, credentials')
      .eq('team_id', teamId)
      .eq('is_active', true)
      .maybeSingle();
    integration = data;
  }

  if (!integration && channelId) {
    const { data } = await supabase
      .from('slack_integrations')
      .select('id, user_id, enterprise_id, channel_id, credentials')
      .eq('channel_id', channelId)
      .eq('is_active', true)
      .maybeSingle();
    integration = data;
  }

  if (!integration) {
    // Last resort: find any active integration (single-tenant deployments)
    const { data } = await supabase
      .from('slack_integrations')
      .select('id, user_id, enterprise_id, channel_id, credentials')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    integration = data;
  }

  if (!integration) {
    console.error('[Slack callback] No integration found. team_id:', teamId, 'channel_id:', channelId);
    return NextResponse.json({ error: 'No active Slack integration found' }, { status: 401 });
  }

  console.log('[Slack callback] Found integration:', integration.id, 'channel:', integration.channel_id);

  // Verify signature
  let creds;
  try {
    creds = await decryptSlackCredentials(integration.credentials, `slack_integrations/id=${integration.id}`);
  } catch (err) {
    console.error('[Slack callback] Credential decrypt failed:', (err as Error).message);
    return NextResponse.json({ error: 'Credential error' }, { status: 500 });
  }

  if (!verifySlackSignature(creds.signingSecret, timestamp, rawBody, slackSignature)) {
    console.error('[Slack callback] Signature verification failed. timestamp:', timestamp, 'has_signature:', !!slackSignature);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const action = payload.actions?.[0];
  if (!action) {
    return NextResponse.json({ ok: true });
  }

  const actionId = action.action_id;
  const recId = action.value;
  const responseUrl = payload.response_url;
  const slackUsername = payload.user?.name ?? payload.user?.username ?? 'unknown';
  const ownerId = integration.user_id;
  const enterpriseId = integration.enterprise_id;

  // Respond immediately — Slack requires HTTP 200 within 3 seconds
  // We process async via the response_url
  if (actionId === 'slack_approve_confirm') {
    // Show ephemeral confirmation
    const { data: rec } = await supabase
      .from('ai_recommendations')
      .select('action, recommended_amount_usd, stablecoin_token')
      .eq('id', recId)
      .eq('enterprise_id', enterpriseId)
      .maybeSingle();

    const amount = rec?.recommended_amount_usd ? `$${parseFloat(rec.recommended_amount_usd).toLocaleString()} ${rec.stablecoin_token ?? 'USDC'}` : 'this amount';
    const actionLabel = rec?.action === 'onramp' ? `${amount} on-ramp` : rec?.action === 'offramp' ? `${amount} off-ramp` : 'this action';

    await postEphemeralConfirmation(responseUrl, recId, actionLabel);
    return NextResponse.json({ ok: true });
  }

  if (actionId === 'slack_approve_cancel') {
    // Dismiss — do nothing, just ack
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        replace_original: false,
        delete_original: false,
        text: 'Action cancelled.',
      }),
    });
    return NextResponse.json({ ok: true });
  }

  if (actionId === 'slack_approve_execute') {
    // Execute the recommendation
    const { data: rec, error: fetchErr } = await supabase
      .from('ai_recommendations')
      .select('*')
      .eq('id', recId)
      .eq('user_id', ownerId)
      .eq('enterprise_id', enterpriseId)
      .maybeSingle();

    if (fetchErr || !rec) {
      await respondViaUrl(responseUrl, '❌ Recommendation not found or access denied.');
      return NextResponse.json({ ok: true });
    }
    if (rec.status !== 'pending_approval') {
      await respondViaUrl(responseUrl, `❌ Cannot execute: recommendation is already ${rec.status}.`);
      return NextResponse.json({ ok: true });
    }
    if (new Date(rec.expires_at) < new Date()) {
      await respondViaUrl(responseUrl, '❌ This recommendation has expired.');
      return NextResponse.json({ ok: true });
    }
    if (rec.action === 'no_action' || !rec.recommended_amount_usd) {
      await respondViaUrl(responseUrl, '❌ No action to execute.');
      return NextResponse.json({ ok: true });
    }

    // ─── Policy gate ──────────────────────────────────────────────
    // Gate the Slack-approved ramp the same way as the UI approve path.
    // Actor is the Slack integration owner; their role is fetched from
    // user_profiles since we don't have a session here.
    const { data: ownerProfile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', ownerId)
      .maybeSingle();

    if (!ownerProfile?.role) {
      await respondViaUrl(responseUrl, '❌ Slack integration owner has no profile role; contact support.');
      return NextResponse.json({ ok: true });
    }

    const movement = mapRecommendationToMovement(
      {
        recommendationId: rec.id,
        action: rec.action as 'onramp' | 'offramp',
        cryptoToken: (rec.stablecoin_token ?? 'USDC') as 'USDC' | 'USDT',
        amountUsd: parseFloat(rec.recommended_amount_usd),
        fiatCurrency: 'USD',
        bankAccountId: rec.bank_account_id,
      },
      { userId: ownerId, enterpriseId, fromAddress: '' },
    );

    const gateService = new PolicyGateService(supabase, {
      evaluate: buildProductionEvaluate(supabase),
      approvalService: new ApprovalWorkflowService(supabase),
    });

    const actor: GateActor = {
      user_id: ownerId,
      role: ownerProfile.role as GateActor['role'],
      enterprise_id: enterpriseId,
    };

    let gateResult;
    try {
      gateResult = await gateService.gate(movement, actor);
    } catch (err) {
      if (err instanceof GateError) {
        await supabase
          .from('ai_recommendations')
          .update({
            status: 'rejected',
            rejected_by: ownerId,
            rejected_at: new Date().toISOString(),
            rejection_reason: err.reason_code,
            updated_at: new Date().toISOString(),
          })
          .eq('id', recId)
          .eq('enterprise_id', enterpriseId);

        await writeAuditLog({
          userId: ownerId,
          action: 'transfer_create_blocked',
          entityType: 'ai_recommendation',
          entityId: recId,
          details: {
            slack_user: slackUsername,
            reason_code: err.reason_code,
            ...(err.details as Record<string, unknown>),
          },
        });

        await respondViaUrl(
          responseUrl,
          `❌ Policy blocked this recommendation (${err.reason_code}). ${err.human_readable}`,
        );
        return NextResponse.json({ ok: true });
      }
      throw err;
    }

    // Mark approved (treasurer-equivalent: Slack integration owner
    // approved here; further approvals may still be pending).
    await supabase
      .from('ai_recommendations')
      .update({
        status: 'approved',
        approved_by: ownerId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', recId);

    await writeAuditLog({
      userId: ownerId,
      action: 'slack_recommendation_approve',
      entityType: 'ai_recommendation',
      entityId: recId,
      details: { slack_user: slackUsername, action: rec.action, amount_usd: rec.recommended_amount_usd },
    });

    if (gateResult.verdict === 'require_approval') {
      // Link the rec to the pending approval request so UI can resolve
      // the in-between state (approved-by-Slack, awaiting-CFO, etc.).
      await supabase
        .from('ai_recommendations')
        .update({
          pending_approval_request_id: gateResult.approval_request.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recId)
        .eq('enterprise_id', enterpriseId);

      await writeAuditLog({
        userId: ownerId,
        action: 'transfer_create_requires_approval',
        entityType: 'ai_recommendation',
        entityId: recId,
        details: {
          slack_user: slackUsername,
          approval_request_id: gateResult.approval_request.id,
          chain_id: gateResult.approval_request.chain_id,
        },
      });
      await respondViaUrl(
        responseUrl,
        `⏳ Approved by ${slackUsername}, but policy requires additional approvers (${gateResult.evaluation.required_chain?.chain_name ?? 'approval chain'}). The ramp will execute when the chain completes.`,
      );
      return NextResponse.json({ ok: true });
    }

    // allow_auto — execute the ramp.
    try {
      const adapter = getBankingAdapter('live');
      const rampResult = await adapter.executeRamp({
        direction: rec.action as 'onramp' | 'offramp',
        cryptoToken: rec.stablecoin_token ?? 'USDC',
        cryptoAmount: parseFloat(rec.recommended_amount_usd),
        fiatAmount: parseFloat(rec.recommended_amount_usd),
        fiatCurrency: 'USD',
        exchangeRate: 1,
        feeAmount: 0,
        bankAccountRef: rec.bank_account_id ?? undefined,
      });

      const { data: fiatTx } = await supabase
        .from('fiat_transactions')
        .insert({
          user_id: ownerId,
          enterprise_id: enterpriseId,
          bank_account_id: rec.bank_account_id,
          direction: rec.action,
          crypto_amount: parseFloat(rec.recommended_amount_usd),
          crypto_token: rec.stablecoin_token ?? 'USDC',
          fiat_amount: parseFloat(rec.recommended_amount_usd),
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
          status: 'executed',
          executed_at: new Date().toISOString(),
          fiat_transaction_id: fiatTx?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recId);

      // Update balances (mock fallback — real balances sync from bank/chain)
      await updateBalancesAfterRamp({
        direction: rec.action as 'onramp' | 'offramp',
        walletId: rec.wallet_id,
        bankAccountId: rec.bank_account_id,
        token: rec.stablecoin_token ?? 'USDC',
        cryptoAmount: parseFloat(rec.recommended_amount_usd),
        fiatAmount: parseFloat(rec.recommended_amount_usd),
      });

      await writeAuditLog({
        userId: ownerId,
        action: 'treasury_recommendation_execute',
        entityType: 'ai_recommendation',
        entityId: recId,
        details: { provider_tx_id: rampResult.providerTransactionId, via_slack: true, slack_user: slackUsername },
      });

      const amount = `$${parseFloat(rec.recommended_amount_usd).toLocaleString()} ${rec.stablecoin_token ?? 'USDC'}`;
      const verb = rec.action === 'onramp' ? 'on-ramp' : 'off-ramp';

      // Update original message
      if (payload.container?.channel_id && payload.container?.message_ts) {
        await updateSlackMessage(
          creds.botToken,
          payload.container.channel_id,
          payload.container.message_ts,
          `✅ Approved and executed by @${slackUsername} (via Slack) — ${amount} ${verb} initiated`
        );
      }

      // Dismiss ephemeral
      await respondViaUrl(responseUrl, `✅ Executed! ${amount} ${verb} initiated.`);
    } catch (execErr) {
      await supabase
        .from('ai_recommendations')
        .update({
          execution_error: (execErr as Error).message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recId);

      await respondViaUrl(responseUrl, `❌ Execution failed: ${(execErr as Error).message}`);
    }

    return NextResponse.json({ ok: true });
  }

  // ---- Scheduled Operations ----

  if (actionId === 'scheduled_op_deny') {
    const operationId = action.value;

    const { data: op, error: fetchErr } = await supabase
      .from('scheduled_operations')
      .select('id, type, status, enterprise_id')
      .eq('id', operationId)
      .maybeSingle();

    if (fetchErr || !op) {
      await respondViaUrl(responseUrl, '❌ Scheduled operation not found.');
      return NextResponse.json({ ok: true });
    }

    if (op.status !== 'awaiting_authorization') {
      await respondViaUrl(responseUrl, `❌ Cannot deny: operation is already ${op.status}.`);
      return NextResponse.json({ ok: true });
    }

    await supabase
      .from('scheduled_operations')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', operationId);

    await writeAuditLog({
      userId: ownerId,
      action: 'scheduled_operation_cancel' as any,
      entityType: 'scheduled_operation',
      entityId: operationId,
      details: { via_slack: true, slack_user: slackUsername, previous_status: 'awaiting_authorization' },
    });

    await postScheduledOpConfirmation(creds.botToken, integration.channel_id, { id: operationId, type: op.type }, 'cancelled');
    return NextResponse.json({ ok: true });
  }

  if (actionId === 'scheduled_op_approve_review') {
    const operationId = action.value;

    const { data: op, error: fetchErr } = await supabase
      .from('scheduled_operations')
      .select('id, type, status, tolerance_bps, deviation_bps, initial_quote, execution_quote, params')
      .eq('id', operationId)
      .maybeSingle();

    if (fetchErr || !op) {
      await respondViaUrl(responseUrl, '❌ Scheduled operation not found.');
      return NextResponse.json({ ok: true });
    }

    // Fetch fresh quote via banking adapter
    let currentRate: number | null = null;
    let originalRate: number | null = null;
    let freshDeviationBps: number | null = null;

    try {
      const adapter = getBankingAdapter('live');
      const { extractRate, calculateDeviationBps } = await import('@/lib/scheduled-operations/tolerances');
      let freshQuote: Record<string, unknown> | null = null;
      const params = op.params as Record<string, unknown>;

      switch (op.type) {
        case 'swap':
          freshQuote = await adapter.getSwapQuote({
            chain: params.chain as any,
            fromToken: params.fromToken as any,
            toToken: params.toToken as any,
            amount: params.amount as string,
            walletAddress: params.walletAddress as string,
          }) as unknown as Record<string, unknown>;
          break;
        case 'bridge':
          freshQuote = await adapter.getBridgeQuote({
            token: params.token as any,
            amount: params.amount as string,
            fromChain: params.fromChain as any,
            toChain: params.toChain as any,
            walletAddress: params.walletAddress as string,
          }) as unknown as Record<string, unknown>;
          break;
        case 'ramp':
          freshQuote = await adapter.getRampQuote({
            direction: params.direction as 'onramp' | 'offramp',
            cryptoToken: params.cryptoToken as 'USDC' | 'USDT',
            fiatCurrency: params.fiatCurrency as string ?? 'USD',
            cryptoAmount: params.cryptoAmount as number,
          }) as unknown as Record<string, unknown>;
          break;
      }

      if (freshQuote) {
        currentRate = extractRate(op.type, freshQuote);
        originalRate = extractRate(op.type, op.initial_quote as Record<string, unknown>);
        if (originalRate !== 0) {
          freshDeviationBps = calculateDeviationBps(originalRate, currentRate);
        }
      }
    } catch {
      // Non-fatal — show what we have
    }

    const rateInfo = currentRate != null && originalRate != null
      ? `*Original rate:* ${originalRate}\n*Current rate:* ${currentRate}\n*Deviation:* ${freshDeviationBps ?? op.deviation_bps ?? 'n/a'} bps (tolerance: ${op.tolerance_bps} bps)`
      : `*Stored deviation:* ${op.deviation_bps ?? 'n/a'} bps (tolerance: ${op.tolerance_bps} bps)\n_Could not fetch fresh quote._`;

    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        replace_original: false,
        text: `Review scheduled ${op.type}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Review Scheduled ${op.type.charAt(0).toUpperCase() + op.type.slice(1)}* (${operationId.slice(0, 8)}…)\n\n${rateInfo}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Confirm Execute', emoji: true },
                style: 'primary',
                action_id: 'scheduled_op_confirm_execute',
                value: operationId,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Cancel', emoji: true },
                action_id: 'slack_approve_cancel',
                value: operationId,
              },
            ],
          },
        ],
      }),
    });

    return NextResponse.json({ ok: true });
  }

  if (actionId === 'scheduled_op_confirm_execute') {
    const operationId = action.value;

    const { data: op, error: fetchErr } = await supabase
      .from('scheduled_operations')
      .select('*')
      .eq('id', operationId)
      .maybeSingle();

    if (fetchErr || !op) {
      await respondViaUrl(responseUrl, '❌ Scheduled operation not found.');
      return NextResponse.json({ ok: true });
    }

    try {
      const { approveAndExecute } = await import('@/lib/scheduled-operations/executor');
      const result = await approveAndExecute(op);

      if (!result.executed) {
        await respondViaUrl(responseUrl, `❌ Execution failed: ${result.error ?? 'Unknown error'}`);
        return NextResponse.json({ ok: true });
      }

      await postScheduledOpConfirmation(creds.botToken, integration.channel_id, { id: operationId, type: op.type }, 'executed');
      await respondViaUrl(responseUrl, `✅ Scheduled ${op.type} executed successfully.`);
    } catch (execErr) {
      await respondViaUrl(responseUrl, `❌ Execution failed: ${(execErr as Error).message}`);
    }

    return NextResponse.json({ ok: true });
  }

  if (actionId === 'slack_reject') {
    const { data: rec, error: fetchErr } = await supabase
      .from('ai_recommendations')
      .select('id, status, action, recommended_amount_usd, stablecoin_token')
      .eq('id', recId)
      .eq('user_id', ownerId)
      .eq('enterprise_id', enterpriseId)
      .maybeSingle();

    if (fetchErr || !rec) {
      await respondViaUrl(responseUrl, '❌ Recommendation not found or access denied.');
      return NextResponse.json({ ok: true });
    }
    if (rec.status !== 'pending_approval') {
      await respondViaUrl(responseUrl, `❌ Cannot reject: recommendation is already ${rec.status}.`);
      return NextResponse.json({ ok: true });
    }

    await supabase
      .from('ai_recommendations')
      .update({
        status: 'rejected',
        rejected_by: ownerId,
        rejected_at: new Date().toISOString(),
        rejection_reason: `Rejected via Slack by @${slackUsername}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recId);

    await writeAuditLog({
      userId: ownerId,
      action: 'slack_recommendation_reject',
      entityType: 'ai_recommendation',
      entityId: recId,
      details: { slack_user: slackUsername, action: rec.action, amount_usd: rec.recommended_amount_usd },
    });

    const amount = rec.recommended_amount_usd
      ? `$${parseFloat(rec.recommended_amount_usd).toLocaleString()} ${rec.stablecoin_token ?? 'USDC'}`
      : 'recommendation';

    // Update original message
    if (payload.container?.channel_id && payload.container?.message_ts) {
      await updateSlackMessage(
        creds.botToken,
        payload.container.channel_id,
        payload.container.message_ts,
        `❌ Rejected by @${slackUsername} (via Slack) — ${amount} ${rec.action}`
      );
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

async function respondViaUrl(responseUrl: string, text: string) {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }),
  });
}

// ---- Slack Payload Types ----

interface SlackInteractionPayload {
  team?: { id: string; domain: string };
  user?: { id: string; name?: string; username?: string };
  response_url: string;
  container?: { channel_id: string; message_ts: string };
  actions?: Array<{ action_id: string; value: string }>;
}
