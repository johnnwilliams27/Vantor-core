/**
 * Claude reasoning for treasury insights.
 *
 * Generates a short AI narrative for critical/warning insights. The
 * narrative is written into `ai_reasoning` on the insight row and
 * displayed in InsightCard below the template summary.
 *
 * Mirrors the pattern in `src/lib/treasury/claude.ts` (treasury
 * recommendations reasoning). Same model, same mock mode, same
 * dynamic import of the Anthropic SDK.
 */

import type { DetectedInsight } from './types';

const MOCK_MODE = !process.env.ANTHROPIC_API_KEY;

export interface InsightReasoningResult {
  reasoning: string;
  model: string;
}

// ─── Mock ───────────────────────────────────────────────────────────

function mockInsightReasoning(insight: DetectedInsight): string {
  const typeLabel = insight.type.replace(/_/g, ' ');
  return (
    `🔍 **Analysis**\n` +
    `${insight.summary}\n\n` +
    `💡 **Context**\n` +
    `This ${typeLabel} was detected with ${Math.round(insight.confidence * 100)}% confidence based on current treasury state.\n\n` +
    `✅ **Next Step**\n` +
    (insight.recommendedAction
      ? `Review the recommended ${insight.recommendedAction.type.replace(/_/g, ' ')} of $${insight.recommendedAction.amountUsd.toLocaleString()} and approve if appropriate.`
      : `Review the current position and determine if rebalancing is needed.`)
  );
}

// ─── Real ───────────────────────────────────────────────────────────

/**
 * Generate a concise AI reasoning narrative for an insight.
 *
 * Called after `createInsight()` succeeds — the reasoning is written
 * back to the row via an UPDATE. Non-blocking in the caller; if this
 * fails the insight still exists with its template summary.
 */
export async function generateInsightReasoning(
  insight: DetectedInsight,
): Promise<InsightReasoningResult> {
  if (MOCK_MODE) {
    return { reasoning: mockInsightReasoning(insight), model: 'mock' };
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const contextBlock = JSON.stringify(
    {
      type: insight.type,
      severity: insight.severity,
      title: insight.title,
      summary: insight.summary,
      rationale: insight.rationale,
      recommendedAction: insight.recommendedAction,
      impact: insight.impact,
      confidence: insight.confidence,
    },
    null,
    2,
  );

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 384,
    system:
      'You are Vantor\'s treasury AI. Explain a detected insight using exactly 3 sections:\n\n' +
      '🔍 **Analysis**\nOne sentence explaining what was detected and why it matters.\n\n' +
      '💡 **Context**\nOne sentence with the key numbers (dollar amounts, APY, percentages) that triggered this.\n\n' +
      '✅ **Next Step**\nOne sentence with a specific, actionable recommendation.\n\n' +
      'Keep each section to exactly 1 sentence. Use specific dollar amounts. No other formatting. ' +
      'Never suggest auto-executing — all actions require treasurer approval.',
    messages: [
      {
        role: 'user',
        content: `Treasury insight detected:\n\n${contextBlock}\n\nProvide your analysis.`,
      },
    ],
  });

  const content = message.content[0];
  const reasoning = content.type === 'text' ? content.text : 'Reasoning unavailable.';

  return { reasoning, model: 'claude-sonnet-4-6' };
}
