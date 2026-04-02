import type { RecommendationInput } from './interface';
import type { ForecastDataPoint } from '@/types/database';

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
    return `📊 **Current Position**\nBank balance of ${bankBal} is within the ${target} safety buffer target.\n\n📋 **Obligations**\n${obligations} in obligations due over the next ${lookaheadDays} days are fully covered.\n\n✅ **Recommendation**\nNo action required.`;
  }

  if (action === 'onramp') {
    // Excess fiat → deploy to stablecoin (fiat → crypto)
    return `📊 **Current Position**\nBank balance of ${bankBal} exceeds the ${target} safety buffer by ${surplus}.\n\n💡 **Reasoning**\nOnly ${obligations} in obligations are due within ${lookaheadDays} days, leaving excess fiat that can earn yield.\n\n✅ **Recommendation**\nOn-ramp ${formatUsd(recommendedAmountUsd ?? 0)} USD to ${input.targetStablecoinToken} on ${input.targetChain}.`;
  }

  // offramp — stablecoin to fiat (user needs fiat, liquidate crypto)
  return `📊 **Current Position**\nBank balance of ${bankBal} is ${surplus} below the ${target} safety buffer.\n\n⚠️ **Reasoning**\n${obligations} in obligations are due within ${lookaheadDays} days and current fiat reserves are insufficient. Crypto treasury holds ${cryptoBal}.\n\n✅ **Recommendation**\nOff-ramp ${formatUsd(recommendedAmountUsd ?? 0)} ${input.targetStablecoinToken} to USD.`;
}

export interface ForecastSummaryInput {
  lookaheadDays: number;
  currentBankBalanceUsd: number;
  forecastPoints: ForecastDataPoint[];
  dangerDays: number;
  worstProjectedBalance: number;
  totalObligationsInWindow: number;
}

function mockForecastSummary(input: ForecastSummaryInput): string {
  const { lookaheadDays, currentBankBalanceUsd, dangerDays, worstProjectedBalance, totalObligationsInWindow } = input;
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  if (dangerDays === 0) {
    return `[MOCK] Over the next ${lookaheadDays} days, the projected bank balance remains above the safety buffer throughout the window. Starting balance of ${fmt(currentBankBalanceUsd)} is sufficient to cover ${fmt(totalObligationsInWindow)} in total obligations. No liquidity risk detected.`;
  }

  return `[MOCK] Over the next ${lookaheadDays} days, the projected bank balance drops below the safety buffer on ${dangerDays} day(s), with a worst-case balance of ${fmt(worstProjectedBalance)}. Total obligations in the window are ${fmt(totalObligationsInWindow)}. Consider executing an on-ramp to restore adequate liquidity coverage.`;
}

export async function generateForecastSummary(
  input: ForecastSummaryInput
): Promise<ReasoningResult> {
  if (MOCK_MODE) {
    return {
      reasoning: mockForecastSummary(input),
      model: 'mock',
    };
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const contextBlock = JSON.stringify({
    lookaheadDays: input.lookaheadDays,
    currentBankBalanceUsd: input.currentBankBalanceUsd,
    dangerDays: input.dangerDays,
    worstProjectedBalance: input.worstProjectedBalance,
    totalObligationsInWindow: input.totalObligationsInWindow,
    forecastSample: input.forecastPoints.slice(0, 7).map((p) => ({
      date: p.date,
      projectedBalanceUsd: p.projectedBalanceUsd,
      obligationsDueUsd: p.obligationsDueUsd,
      safetyBufferUsd: p.safetyBufferUsd,
      isBelow: p.isBelow,
    })),
  }, null, 2);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system:
      'You are a treasury AI assistant for Vantor. Analyze the cash flow forecast data and provide a concise 2-3 sentence summary of the liquidity outlook. Be specific about dollar amounts, risk days, and whether action is recommended. Write in clear prose without bullet points.',
    messages: [
      {
        role: 'user',
        content: `Cash flow forecast summary:\n\n${contextBlock}\n\nProvide a brief treasury outlook summary.`,
      },
    ],
  });

  const content = message.content[0];
  const reasoning = content.type === 'text' ? content.text : 'Summary unavailable.';

  return {
    reasoning,
    model: 'claude-sonnet-4-6',
  };
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
      'You are a treasury AI assistant. Explain the recommended action using exactly 3 sections with this format:\n\n' +
      '📊 **Current Position**\nOne sentence about balances and safety buffer.\n\n' +
      '💡 **Reasoning**\nOne sentence explaining why this action makes sense. Use ⚠️ instead of 💡 if there is a liquidity shortfall.\n\n' +
      '✅ **Recommendation**\nOne sentence with the specific action and dollar amount.\n\n' +
      'Keep each section to exactly 1 sentence. Use specific dollar amounts. No other formatting.',
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
