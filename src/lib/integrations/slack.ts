import crypto from 'crypto';

// ---- Types ----

export interface SlackCredentials {
  botToken: string;
  signingSecret: string;
}

export interface SlackIntegrationConfig {
  id: string;
  userId: string;
  workspaceName: string | null;
  teamId: string | null;
  channelId: string;
  channelName: string | null;
  isActive: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

// ---- Encryption (same base64 passthrough pattern as ERP credentials) ----

export function encryptSlackCredentials(creds: SlackCredentials): string {
  // In production: AES-256-GCM encrypt using CREDENTIALS_ENCRYPTION_KEY
  return Buffer.from(JSON.stringify(creds)).toString('base64');
}

export function decryptSlackCredentials(encrypted: string): SlackCredentials {
  try {
    return JSON.parse(Buffer.from(encrypted, 'base64').toString('utf-8')) as SlackCredentials;
  } catch {
    throw new Error('Failed to decrypt Slack credentials');
  }
}

// ---- Signature Verification ----

export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  slackSignature: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(baseString);
  const computed = `v0=${hmac.digest('hex')}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSignature));
  } catch {
    return false;
  }
}

// ---- Slack API Helpers ----

async function slackPost(token: string, endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; error?: string; ts?: string; channel?: string }>;
}

// ---- Block Kit Messages ----

export async function postRecommendationToSlack(
  botToken: string,
  channelId: string,
  rec: {
    id: string;
    action: string;
    recommendedAmountUsd: number | null;
    stablecoinToken: string | null;
    stablecoinChain: string | null;
    aiReasoning: string;
  }
): Promise<{ ts: string; channel: string } | null> {
  const actionLabel = rec.action === 'onramp'
    ? `On-ramp $${rec.recommendedAmountUsd?.toLocaleString()} ${rec.stablecoinToken ?? 'USDC'} to ${rec.stablecoinChain ?? 'Ethereum'}`
    : rec.action === 'offramp'
    ? `Off-ramp $${rec.recommendedAmountUsd?.toLocaleString()} ${rec.stablecoinToken ?? 'USDC'} from ${rec.stablecoinChain ?? 'Ethereum'}`
    : 'No action required';

  const reasoningSnippet = rec.aiReasoning.length > 200
    ? rec.aiReasoning.slice(0, 197) + '...'
    : rec.aiReasoning;

  const result = await slackPost(botToken, 'chat.postMessage', {
    channel: channelId,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🏦 Treasury Recommendation — Action Required', emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Action:*\n${actionLabel}` },
          { type: 'mrkdwn', text: `*Status:*\nPending Approval` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*AI Reasoning:*\n_"${reasoningSnippet}"_` },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve', emoji: true },
            style: 'primary',
            action_id: 'slack_approve_confirm',
            value: rec.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Deny', emoji: true },
            style: 'danger',
            action_id: 'slack_reject',
            value: rec.id,
          },
        ],
      },
    ],
    text: `Treasury Recommendation: ${actionLabel}`,
  });

  if (!result.ok) return null;
  return { ts: result.ts ?? '', channel: result.channel ?? channelId };
}

export async function updateSlackMessage(
  botToken: string,
  channelId: string,
  ts: string,
  text: string
): Promise<void> {
  await slackPost(botToken, 'chat.update', {
    channel: channelId,
    ts,
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text },
      },
    ],
  });
}

export async function postEphemeralConfirmation(
  responseUrl: string,
  recId: string,
  actionLabel: string
): Promise<void> {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: 'ephemeral',
      replace_original: false,
      text: `⚠️ Confirm execution of ${actionLabel}?`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⚠️ *Confirm execution of ${actionLabel}?*\nThis will initiate a real fund transfer.`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Yes, Execute', emoji: true },
              style: 'primary',
              action_id: 'slack_approve_execute',
              value: recId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Cancel', emoji: true },
              action_id: 'slack_approve_cancel',
              value: recId,
            },
          ],
        },
      ],
    }),
  });
}

export async function postTestMessage(botToken: string, channelId: string): Promise<{ ok: boolean; error?: string }> {
  return slackPost(botToken, 'chat.postMessage', {
    channel: channelId,
    text: '✅ Vantor Treasury: Slack integration connected successfully! You will receive treasury recommendations here.',
  });
}
