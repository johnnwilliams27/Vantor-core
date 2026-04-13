import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Shape of an invoice row as written by the ERP sync paths. Mirrors the
 * `invoices` table columns we care about for obligation mirroring.
 */
export interface InvoiceLike {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  invoice_number: string;
  description: string | null;
  amount: number | string;
  token: string;
  chain: string;
  direction: 'inflow' | 'outflow';
  due_date: string | null;
  status: string;  // invoice_status enum as string
}

/**
 * Map an invoice status to the corresponding obligation status. Anything
 * that's not paid/cancelled is still owed, so treat it as upcoming.
 */
function mapStatus(invoiceStatus: string): 'upcoming' | 'paid' | 'cancelled' {
  if (invoiceStatus === 'paid') return 'paid';
  if (invoiceStatus === 'cancelled') return 'cancelled';
  return 'upcoming';
}

/**
 * Mirror an ERP invoice into the obligations table so the rules engine
 * and ForecastService see it through the canonical path. Keyed on
 * (source='erp_sync', source_ref_id=invoice.id). Uses explicit
 * select-then-update-or-insert because the unique index from migration
 * 0053 is partial (WHERE source='erp_sync') and PostgREST's upsert
 * onConflict doesn't accept partial-index conflict targets.
 *
 * Stablecoin tokens (USDC/USDT) are kept as the obligation currency.
 * At ~1 USD par they pass through buildFxRates as 1.0 unchanged.
 */
export async function upsertObligationFromInvoice(
  db: SupabaseClient,
  invoice: InvoiceLike,
): Promise<{ ok: boolean; error?: string }> {
  if (!invoice.enterprise_id) {
    return { ok: false, error: 'enterprise_id required' };
  }
  const status = mapStatus(invoice.status);
  const isActive = status === 'upcoming';
  const dueDate = invoice.due_date ?? (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().slice(0, 10);
  })();

  const row = {
    user_id: invoice.user_id,
    enterprise_id: invoice.enterprise_id,
    label: `Invoice ${invoice.invoice_number}`,
    description: invoice.description,
    direction: invoice.direction,
    amount: invoice.amount,
    amount_usd: invoice.amount,          // legacy mirror (stablecoin @ ~1 USD)
    currency: invoice.token,             // 'USDC', 'USDT', etc.
    due_date: dueDate,
    confidence: 'confirmed' as const,
    source: 'erp_sync' as const,
    source_ref_id: invoice.id,
    recurrence: 'once' as const,
    is_recurring: false,                 // legacy mirror
    status,
    is_active: isActive,
    erp_reference: invoice.invoice_number,
    metadata: {
      invoice_number: invoice.invoice_number,
      description: invoice.description,
      chain: invoice.chain,
    },
    paid_at: status === 'paid' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await db
    .from('obligations')
    .select('id')
    .eq('source', 'erp_sync')
    .eq('source_ref_id', invoice.id)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await db
      .from('obligations')
      .update(row)
      .eq('id', existing.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { error } = await db.from('obligations').insert(row);
  return error ? { ok: false, error: error.message } : { ok: true };
}
