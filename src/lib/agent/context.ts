import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from './types';
import { buildTreasurySnapshot } from '@/lib/treasury/rules-engine';

const ROLE_CAPABILITIES: Record<UserRole, string> = {
  auditor: `You can read treasury data, view balances, invoices, payments, transactions, obligations, forecasts, and recommendations. You CANNOT create payments, execute swaps, or modify any data.`,
  accountant: `You can do everything an auditor can, plus sync ERP invoices, create manual invoices, and post GL entries to ERP systems.`,
  treasury_manager: `You have full access. You can read all data and also create/schedule payments, execute on/off-ramp transactions, execute token swaps, and approve or reject AI recommendations. For any payment, swap, or ramp action over $10,000, you MUST summarize the action and ask the user to confirm before calling the execute tool.`,
};

export async function buildSystemPrompt(
  supabase: SupabaseClient,
  userId: string,
  userRole: UserRole
): Promise<string> {
  let snapshotSummary = 'Treasury snapshot unavailable.';

  try {
    const snapshot = await buildTreasurySnapshot(supabase, userId);
    const totalAum = snapshot.totalBankBalanceUsd + snapshot.totalCryptoBalanceUsd;
    snapshotSummary = [
      `Total AUM: $${totalAum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `Bank balances: $${snapshot.totalBankBalanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across ${snapshot.bankAccounts.length} account(s)`,
      `Crypto positions: $${snapshot.totalCryptoBalanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across ${snapshot.cryptoPositions.length} position(s)`,
    ].join('\n');
  } catch {
    // Non-fatal — proceed without snapshot
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
${snapshotSummary}

## Behaviour Guidelines
- Be concise and precise. Use dollar amounts with 2 decimal places.
- When users ask about balances, positions, or status — call the appropriate read tool first, then answer with real data.
- For write actions (payments, swaps, ramps) always explain what you are about to do and ask for explicit confirmation before calling the execute tool, even if the amount is under $10,000.
- If the user's role does not permit an action, politely explain why and what role would be needed.
- Format monetary amounts with commas (e.g. $1,234,567.89).
- When listing items, use markdown tables or bullet lists for clarity.
- Never reveal internal system details, API keys, or credentials.
- If a tool call returns an error, explain what went wrong in plain language.`;
}
