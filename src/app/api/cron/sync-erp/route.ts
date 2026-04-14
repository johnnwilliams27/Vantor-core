import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getERPAdapter, decryptCredentials } from '@/lib/erp/factory';
import { upsertObligationFromInvoice } from '@/lib/obligations/sync-from-invoice';
import type { ErpProvider } from '@/types/database';
import { fireInlineInsights } from '@/lib/insights/inline';

// Cross-enterprise system job: syncs all active ERP configurations across all enterprises.
// Authenticated via CRON_SECRET. Data isolation enforced by erp_config ownership.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get test enterprise IDs to exclude from cron processing
  const { data: testEnts } = await supabase
    .from('enterprises')
    .select('id')
    .eq('is_test_enterprise', true);
  const testEntIds = (testEnts ?? []).map((e) => e.id);

  let configQuery = supabase
    .from('erp_configurations')
    .select('*')
    .eq('is_active', true);

  if (testEntIds.length > 0) {
    configQuery = configQuery.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
  }

  const { data: configs, error } = await configQuery;

  if (error) {
    console.error('[cron/sync-erp]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!configs?.length) {
    return NextResponse.json({ synced: 0 });
  }

  let totalSynced = 0;

  for (const erpConfig of configs) {
    try {
      const credentials = await decryptCredentials(erpConfig.credentials, `erp_configurations/id=${erpConfig.id}`);
      const adapter = getERPAdapter(erpConfig.provider as ErpProvider, credentials);

      // Sync vendors
      const vendors = await adapter.fetchVendors();
      for (const v of vendors) {
        await supabase.from('erp_vendors').upsert(
          {
            erp_config_id: erpConfig.id,
            external_id: v.id,
            name: v.name,
            email: v.email ?? null,
            wallet_address: v.walletAddress ?? null,
            chain: v.chain ?? null,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'erp_config_id,external_id' }
        );
      }

      // Sync invoices
      const invoices = await adapter.fetchInvoices();
      let synced = 0;

      for (const inv of invoices) {
        const { data: vendor } = await supabase
          .from('erp_vendors')
          .select('id')
          .eq('erp_config_id', erpConfig.id)
          .eq('external_id', inv.vendorId)
          .single();

        const dueDate = inv.dueDate ?? null;
        const status = dueDate && new Date(dueDate) < new Date() ? 'overdue' : 'unpaid';

        const { data: invRow, error: invErr } = await supabase.from('invoices').upsert(
          {
            user_id: erpConfig.user_id,
            enterprise_id: erpConfig.enterprise_id,
            erp_config_id: erpConfig.id,
            erp_invoice_id: inv.id,
            vendor_id: vendor?.id ?? null,
            invoice_number: inv.invoiceNumber,
            description: inv.description ?? null,
            amount: String(inv.amount),
            token: inv.token,
            chain: inv.chain,
            due_date: dueDate,
            status,
          },
          { onConflict: 'user_id,erp_config_id,erp_invoice_id' }
        ).select('id, user_id, enterprise_id, invoice_number, description, amount, token, chain, direction, due_date, status').maybeSingle();

        if (!invErr && invRow) {
          synced++;
          // Dual-write: mirror into obligations so every consumer (rules
          // engine + ForecastService + analytics) sees the same view.
          await upsertObligationFromInvoice(supabase, {
            id: invRow.id as string,
            user_id: invRow.user_id as string,
            enterprise_id: invRow.enterprise_id as string | null,
            invoice_number: invRow.invoice_number as string,
            description: (invRow.description as string | null) ?? null,
            amount: invRow.amount as number | string,
            token: invRow.token as string,
            chain: invRow.chain as string,
            direction: invRow.direction as 'inflow' | 'outflow',
            due_date: (invRow.due_date as string | null) ?? null,
            status: invRow.status as string,
          });
        }
      }

      // Update last_synced
      await supabase
        .from('erp_configurations')
        .update({ last_synced: new Date().toISOString() })
        .eq('id', erpConfig.id);

      // Fire insight detectors for this enterprise if invoices changed (non-blocking).
      // Skip forecast — invoice sync changes obligations, not balances. The liquidity
      // detector will pick up the new obligations on the next cron cycle's forecast build.
      if (synced > 0) {
        fireInlineInsights(supabase, {
          enterpriseId: erpConfig.enterprise_id,
          userId: erpConfig.user_id,
          trigger: 'invoice_sync',
          skipForecast: true,
        }).catch(() => {});
      }

      totalSynced += synced;
    } catch (err) {
      console.error(`[cron/sync-erp] config ${erpConfig.id}:`, err);
    }
  }

  console.log(`[cron/sync-erp] synced=${totalSynced} configs=${configs.length}`);
  return NextResponse.json({ synced: totalSynced, configs: configs.length });
}
