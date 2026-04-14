import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getERPAdapter, decryptCredentials } from '@/lib/erp/factory';
import { upsertObligationFromInvoice } from '@/lib/obligations/sync-from-invoice';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import type { ErpProvider } from '@/types/database';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const schema = z.object({ erpConfigId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fetch ERP config
  const { data: erpConfig, error: cfgErr } = await supabase
    .from('erp_configurations')
    .select('*')
    .eq('id', parsed.data.erpConfigId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (cfgErr || !erpConfig) {
    return NextResponse.json({ error: 'ERP config not found' }, { status: 404 });
  }

  const credentials = await decryptCredentials(erpConfig.credentials, `erp_configurations/id=${erpConfig.id}`);
  const adapter = getERPAdapter(erpConfig.provider as ErpProvider, credentials);

  // Sync vendors first
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
    // Find matching vendor
    const { data: vendor } = await supabase
      .from('erp_vendors')
      .select('id')
      .eq('erp_config_id', erpConfig.id)
      .eq('external_id', inv.vendorId)
      .single();

    const dueDate = inv.dueDate ?? null;
    const status = dueDate && new Date(dueDate) < new Date() ? 'overdue' : 'unpaid';

    const { data: invRow, error } = await supabase.from('invoices').upsert(
      {
        user_id: session.user.id,
        enterprise_id: enterpriseId,
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

    if (!error && invRow) {
      synced++;
      // Dual-write: mirror into obligations so the rules engine + ForecastService see the invoice.
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

  await writeAuditLog({
    userId: session.user.id,
    action: 'invoice_sync',
    entityType: 'erp_configuration',
    entityId: erpConfig.id,
    details: { provider: erpConfig.provider, invoicesSynced: synced },
  });

  return NextResponse.json({ data: { synced } });
}
