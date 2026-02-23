import type { RecommendationInput } from './interface';

const MOCK_MODE = !process.env.ANTHROPIC_API_KEY;

export interface ReasoningResult {
  reasoning: string;
  model: string;
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function mockReasoning(input: RecommendationInput): string {
  const {
    action,
    snapshot,
    totalObligationsUsd,
    safetyBufferTargetUsd,
    surplusUsd,
    recommendedAmountUsd,
    lookaheadDays,
  } = input;

  const bankBal = formatUsd(snapshot.totalBankBalanceUsd);
  const cryptoBal = formatUsd(snapshot.totalCryptoBalanceUsd);
  const obligations = formatUsd(totalObligationsUsd);
  const target = formatUsd(safetyBufferTargetUsd);
  const surplus = formatUsd(Math.abs(surplusUsd));

  if (action === 'no_action') {
    return `[MOCK] Treasury position is balanced. Bank balance ${bankBal} is within the safety buffer target of ${target} (${obligations} in obligations over the next ${lookaheadDays} days × ${input.ruleLabel} multiplier). No ramp action is required at this time.`;
  }

  if (action === 'offramp') {
    return `[MOCK] Bank balance ${bankBal} exceeds the safety buffer target of ${target} by ${surplus}. With ${obligations} in fiat obligations due within ${lookaheadDays} days, ${surplus} in excess fiat can be deployed into ${input.targetStablecoinToken} on ${input.targetChain} to earn yield. Recommended offramp: ${formatUsd(recommendedAmountUsd ?? 0)}.`;
  }

  // onramp
  return `[MOCK] Bank balance ${bankBal} falls short of the safety buffer target of ${target} by ${surplus}. With ${obligations} in fiat obligations due within ${lookaheadDays} days, it is necessary to liquidate ${formatUsd(recommendedAmountUsd ?? 0)} in ${input.targetStablecoinToken} to fiat to ensure adequate liquidity. Crypto treasury holds ${cryptoBal}.`;
}

export async function generateTreasuryReasoning(
  input: RecommendationInput
): Promise<ReasoningResult> {
  if (MOCK_MODE) {
    return {
      reasoning: mockReasoning(input),
      model: 'mock',
    };
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const {
    action,
    snapshot,
    totalObligationsUsd,
    safetyBufferTargetUsd,
    surplusUsd,
    recommendedAmountUsd,
    lookaheadDays,
    ruleLabel,
    approvalThresholdUsd,
    targetStablecoinToken,
    targetChain,
    obligationsInWindow,
  } = input;

  const contextBlock = JSON.stringify({
    bankBalanceUsd: snapshot.totalBankBalanceUsd,
    cryptoBalanceUsd: snapshot.totalCryptoBalanceUsd,
    obligationsInWindowUsd: totalObligationsUsd,
    obligationCount: obligationsInWindow.length,
    safetyBufferTargetUsd,
    surplusUsd,
    lookaheadDays,
    ruleLabel,
    action,
    recommendedAmountUsd,
    approvalThresholdUsd,
    targetStablecoin: targetStablecoinToken,
    targetChain,
    topObligations: obligationsInWindow.slice(0, 5).map((o) => ({
      label: o.label,
      amountUsd: o.amountUsd,
      dueDate: o.dueDate,
      source: o.source,
    })),
  }, null, 2);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system:
      'You are a treasury AI assistant for Vantor, a stablecoin treasury management platform. ' +
      'Analyze the treasury snapshot and provide a concise, professional 2-4 sentence explanation ' +
      'of why the recommended action is appropriate. Be specific about dollar amounts and timeframes. ' +
      'Do not use bullet points — write in clear prose.',
    messages: [
      {
        role: 'user',
        content: `Treasury snapshot and recommendation context:\n\n${contextBlock}\n\nPlease provide your reasoning for the recommended action.`,
      },
    ],
  });

  const content = message.content[0];
  const reasoning = content.type === 'text' ? content.text : 'Reasoning unavailable.';

  return {
    reasoning,
    model: 'claude-sonnet-4-6',
  };
}
