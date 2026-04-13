'use client';
import { CheckCircle2, Loader2, XCircle, Wrench } from 'lucide-react';
import type { ToolCallDisplay } from '@/lib/agent/types';

const TOOL_LABELS: Record<string, string> = {
  get_treasury_overview: 'Treasury Overview',
  get_wallets: 'Wallets',
  get_bank_accounts: 'Bank Accounts',
  get_invoices: 'Invoices',
  get_transfers: 'Transfers',
  get_transactions: 'Transactions',
  get_obligations: 'Obligations',
  get_forecast: 'Cash Flow Forecast',
  get_recommendations: 'Recommendations',
  sync_erp_invoices: 'ERP Invoice Sync',
  create_invoice: 'Create Invoice',
  post_gl_entry: 'Post GL Entry',
  create_transfer: 'Create Transfer',
  schedule_transfer: 'Schedule Transfer',
  get_ramp_quote: 'Ramp Quote',
  execute_ramp: 'Execute Ramp',
  get_swap_quote: 'Swap Quote',
  execute_swap: 'Execute Swap',
  approve_recommendation: 'Approve Recommendation',
  reject_recommendation: 'Reject Recommendation',
  generate_recommendation: 'Generate Recommendation',
  get_fiat_payments: 'Bank Payments',
  create_fiat_payment: 'Send Payment',
  schedule_fiat_payment: 'Schedule Payment',
};

function summariseResult(name: string, result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as Record<string, unknown>;
  try {
    if (name === 'get_treasury_overview') {
      const aum = Number(r.totalAumUsd ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      return `Total AUM: ${aum}`;
    }
    if (name === 'get_wallets') {
      return `${(result as unknown as unknown[]).length ?? 0} wallet(s)`;
    }
    if (name === 'get_bank_accounts') {
      return `${(result as unknown as unknown[]).length ?? 0} account(s)`;
    }
    if (name === 'get_invoices' || name === 'get_transfers' || name === 'get_transactions') {
      return `${(result as unknown as unknown[]).length ?? 0} item(s)`;
    }
    if (name === 'get_obligations') {
      const total = Number(r.totalUsd ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      const count = (r.obligations as unknown[])?.length ?? 0;
      return `${count} obligation(s) · ${total} total`;
    }
    if (name === 'create_transfer') {
      return `Transfer created · tx ${String(r.txHash ?? '').slice(0, 10)}...`;
    }
    if (name === 'schedule_transfer') {
      return `Scheduled for ${r.scheduledFor}`;
    }
    if (name === 'sync_erp_invoices') {
      return `Synced ${r.synced}/${r.total} invoices`;
    }
    if (name === 'create_invoice') {
      return `Invoice created`;
    }
    if (name === 'approve_recommendation' || name === 'reject_recommendation') {
      return `Status: ${r.status}`;
    }
    if (r.error) return String(r.error);
  } catch {
    // ignore
  }
  return '';
}

export function ToolCallCard({ toolCall }: { toolCall: ToolCallDisplay }) {
  const label = TOOL_LABELS[toolCall.name] ?? toolCall.name;
  const summary = toolCall.status === 'done'
    ? summariseResult(toolCall.name, toolCall.result)
    : toolCall.status === 'error'
    ? (toolCall.error ?? 'Error')
    : '';

  return (
    <div className="flex items-start gap-2 my-2 px-3 py-2 rounded-lg bg-muted border border-border text-sm">
      <div className="mt-0.5 shrink-0">
        {toolCall.status === 'pending' && (
          <Loader2 className="h-4 w-4 animate-spin text-primary dark:text-teal-400" />
        )}
        {toolCall.status === 'done' && (
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        )}
        {toolCall.status === 'error' && (
          <XCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-foreground font-medium">
          <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
          <span>{label}</span>
        </div>
        {toolCall.status === 'pending' && (
          <p className="text-xs text-muted-foreground mt-0.5">Running...</p>
        )}
        {toolCall.status === 'done' && summary && (
          <p className="text-xs text-muted-foreground mt-0.5">{summary}</p>
        )}
        {toolCall.status === 'error' && (
          <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{toolCall.error}</p>
        )}
      </div>
    </div>
  );
}
