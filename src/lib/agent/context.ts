import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from './types';
import { buildTreasurySnapshot } from '@/lib/treasury/rules-engine';
import { formatFiatAmount } from '@/lib/fx/rates';

const ROLE_CAPABILITIES: Record<UserRole, string> = {
  auditor: `You can read treasury data, view balances, invoices, transfers, transactions, obligations, forecasts, yield positions, and recommendations. You CANNOT create transfers, execute swaps, or modify any data.`,
  accountant: `You can do everything an auditor can, plus sync ERP invoices, create manual invoices, and post GL entries to ERP systems.`,
  treasury_manager: `You have full access. You can read all data and also create/schedule transfers, execute on/off-ramp transactions (USD, EUR, GBP), execute token swaps, manage yield deposits/withdrawals, and approve or reject AI recommendations. You can also perform combined withdraw-and-offramp operations from yield to fiat. You can schedule future swaps, bridges, and ramps — these will auto-execute at the scheduled time if the re-quoted rate is within tolerance (swap: 10bps, bridge: 25bps, ramp: 50bps). If the rate deviates beyond tolerance, the operation requires manual approval. You can proactively suggest scheduling operations based on cash flow analysis, AR/AP, treasury reserves, and invoices. For any transfer, swap, or ramp action over $10,000, you MUST summarize the action and ask the user to confirm before calling the execute or schedule tool. You can send fiat payments between bank accounts in USD, EUR, and GBP. Payments settle in approximately 2 business days.`,
};

export async function buildSystemPrompt(
  supabase: SupabaseClient,
  userId: string,
  userRole: UserRole,
  enterpriseId?: string | null
): Promise<string> {
  let snapshotSummary = 'Treasury snapshot unavailable.';

  let yieldSummary = '';

  try {
    const snapshot = await buildTreasurySnapshot(supabase, userId, undefined, enterpriseId);
    // Total AUM sums every bucket so the headline number reconciles against
    // the dashboard's Total Treasury card. Each bucket is reported
    // separately below so the model can reason about liquidity class.
    const totalAum =
      snapshot.totalBankBalanceUsd +
      snapshot.totalCryptoBalanceUsd +
      snapshot.totalMmfPositionsUsd +
      snapshot.totalDefiPositionsUsd +
      snapshot.totalOtherYieldUsd;

    // Cash equivalents = bank + tokenized MMFs. This matches the Cash
    // card on the dashboard; MMFs are treasurer-mental-model cash.
    const cashEquivalents =
      snapshot.totalBankBalanceUsd + snapshot.totalMmfPositionsUsd;

    const bankDetails = snapshot.bankAccounts.map((a) => {
      const currency = (a as any).nativeCurrency ?? 'USD';
      const nativeBalance = (a as any).currentBalanceNative ?? a.currentBalanceUsd;
      return `  - ${a.institutionName ?? 'Account'} (${currency}): ${formatFiatAmount(nativeBalance, currency)}${currency !== 'USD' ? ` (~$${a.currentBalanceUsd.toLocaleString()})` : ''}`;
    }).join('\n');

    const fmt = (n: number) =>
      n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const totalCashStablecoins = snapshot.totalBankBalanceUsd + snapshot.totalCryptoBalanceUsd;
    const totalYieldPositions = snapshot.totalMmfPositionsUsd + snapshot.totalDefiPositionsUsd;

    snapshotSummary = [
      `Total AUM: $${fmt(totalAum)}`,
      `Cash & Stablecoins: $${fmt(totalCashStablecoins)} (bank $${fmt(snapshot.totalBankBalanceUsd)} + stablecoin wallets $${fmt(snapshot.totalCryptoBalanceUsd)})`,
      `Bank balances: $${fmt(snapshot.totalBankBalanceUsd)} across ${snapshot.bankAccounts.length} account(s)`,
      bankDetails,
      `Stablecoin wallets: $${fmt(snapshot.totalCryptoBalanceUsd)} across ${snapshot.cryptoPositions.length} wallet position(s)`,
      `Yield positions: $${fmt(totalYieldPositions)} (tokenized MMFs $${fmt(snapshot.totalMmfPositionsUsd)} + DeFi protocols $${fmt(snapshot.totalDefiPositionsUsd)})`,
    ].join('\n');
  } catch {
    // Non-fatal — proceed without snapshot
  }

  // Yield positions summary
  try {
    const { data: positions } = await supabase
      .from('yield_positions')
      .select('protocol, underlying_token, deposited_amount, current_value_usd, apy_snapshot')
      .eq('user_id', userId)
      .eq('enterprise_id', enterpriseId)
      .eq('is_active', true);

    if (positions?.length) {
      const totalYield = positions.reduce((s, p) => s + parseFloat(p.current_value_usd ?? '0'), 0);
      const details = positions.map((p) =>
        `  - ${p.protocol}: ${parseFloat(p.deposited_amount).toLocaleString()} ${p.underlying_token} ($${parseFloat(p.current_value_usd ?? '0').toLocaleString()}) @ ${parseFloat(p.apy_snapshot ?? '0').toFixed(2)}% APY`
      ).join('\n');
      yieldSummary = `\nYield positions: $${totalYield.toLocaleString()} total\n${details}`;
    }
  } catch {
    // Non-fatal
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  return `You are Vantor, an AI treasury assistant embedded in a crypto treasury management platform.

## Current Date & Time
${dateStr} at ${timeStr}

## User Role: ${userRole}
${ROLE_CAPABILITIES[userRole]}

## Current Treasury Snapshot
${snapshotSummary}${yieldSummary}

## Multi-Currency Support
The treasury supports USD, EUR, and GBP fiat currencies. Bank accounts may be denominated in any of these currencies. When recommending off-ramp actions:
- Match the destination bank account's currency to minimize FX exposure
- If an obligation is in EUR, prefer off-ramping to a EUR-denominated bank account
- Use the withdraw_and_offramp tool to move funds from yield to fiat in a single operation
- FX conversion fees are approximately 0.15% + spread

## Behaviour Guidelines
- Be concise and precise. Use dollar amounts with 2 decimal places.
- When users ask about balances, positions, or status — call the appropriate read tool first, then answer with real data.
- For write actions (transfers, swaps, ramps) always explain what you are about to do and ask for explicit confirmation before calling the execute tool, even if the amount is under $10,000.
- If the user's role does not permit an action, politely explain why and what role would be needed.
- Format monetary amounts with commas (e.g. $1,234,567.89).
- When listing items, use markdown tables or bullet lists for clarity.
- Never reveal internal system details, API keys, or credentials.
- If a tool call returns an error, explain what went wrong in plain language.`;
}
