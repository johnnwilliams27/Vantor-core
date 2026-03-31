// src/lib/test-mode/seed/erp.ts
import { SeedContext, daysAgo, dateDaysAgo, dateDaysFromNow, rand, pick, ethHash } from './helpers';

const VENDORS = [
  { extId: 'v-001', name: 'Acme Corporation', email: 'billing@acme.example.com', wallet: '0xTESTvendor1111111111111111111111111111', chain: 'ethereum' },
  { extId: 'v-002', name: 'TechSupply Ltd', email: 'ar@techsupply.example.com', wallet: '0xTESTvendor2222222222222222222222222222', chain: 'ethereum' },
  { extId: 'v-003', name: 'Nexus Digital', email: 'finance@nexus.example.com', wallet: 'TESTvendorSo1111111111111111111111111111', chain: 'solana' },
  { extId: 'v-004', name: 'Apex Software', email: 'invoices@apex.example.com', wallet: '0xTESTvendor3333333333333333333333333333', chain: 'ethereum' },
  { extId: 'v-005', name: 'Global Logistics Co', email: 'ap@globallog.example.com', wallet: '0xTESTvendor4444444444444444444444444444', chain: 'ethereum' },
  { extId: 'v-006', name: 'CloudBase Inc', email: 'billing@cloudbase.example.com', wallet: 'TESTvendorSo2222222222222222222222222222', chain: 'solana' },
  { extId: 'v-007', name: 'SecureNet Solutions', email: 'ar@securenet.example.com', wallet: '0xTESTvendor5555555555555555555555555555', chain: 'ethereum' },
  { extId: 'v-008', name: 'DataFlow Analytics', email: 'billing@dataflow.example.com', wallet: '0xTESTvendor6666666666666666666666666666', chain: 'ethereum' },
  { extId: 'v-009', name: 'Prime Consulting', email: 'invoices@prime.example.com', wallet: '0xTESTvendor7777777777777777777777777777', chain: 'ethereum' },
  { extId: 'v-010', name: 'Greenfield Energy', email: 'finance@greenfield.example.com', wallet: 'TESTvendorSo3333333333333333333333333333', chain: 'solana' },
  { extId: 'v-011', name: 'Urban Property Mgmt', email: 'billing@urbanprop.example.com', wallet: '0xTESTvendor8888888888888888888888888888', chain: 'ethereum' },
  { extId: 'v-012', name: 'Legal Eagles LLP', email: 'invoicing@legaleagles.example.com', wallet: '0xTESTvendor9999999999999999999999999999', chain: 'ethereum' },
];

export interface ErpIds {
  erpConfigIds: string[];
  vendorIds: string[];
  invoiceIds: string[];
}

export async function seedErp(ctx: SeedContext): Promise<ErpIds> {
  const { supabase, enterpriseId, userId } = ctx;
  const now = new Date().toISOString();

  const erpCreds = Buffer.from(JSON.stringify({
    apiKey: 'test-erp-key-000',
    baseUrl: 'https://test-erp.example.com',
  })).toString('base64');

  // Insert 2 ERP configs
  const { data: erps } = await supabase
    .from('erp_configurations')
    .insert([
      { user_id: userId, enterprise_id: enterpriseId, provider: 'sap', label: 'SAP S/4HANA', credentials: erpCreds, is_active: true, last_synced: now },
      { user_id: userId, enterprise_id: enterpriseId, provider: 'oracle', label: 'Oracle NetSuite', credentials: erpCreds, is_active: true, last_synced: now },
    ])
    .select('id, provider');

  if (!erps?.length) return { erpConfigIds: [], vendorIds: [], invoiceIds: [] };

  const sapId = erps.find(e => e.provider === 'sap')!.id;
  const oracleId = erps.find(e => e.provider === 'oracle')!.id;

  // Insert vendors — split between SAP (first 7) and Oracle (last 5)
  const vendorRows = VENDORS.map((v, i) => ({
    erp_config_id: i < 7 ? sapId : oracleId,
    enterprise_id: enterpriseId,
    external_id: v.extId,
    name: v.name,
    email: v.email,
    wallet_address: v.wallet,
    chain: v.chain,
    synced_at: now,
  }));

  const { data: vendors } = await supabase
    .from('erp_vendors')
    .insert(vendorRows)
    .select('id, external_id, erp_config_id');

  if (!vendors?.length) return { erpConfigIds: erps.map(e => e.id), vendorIds: [], invoiceIds: [] };

  // Generate 18 invoices across 90-day span
  const invoiceStatuses = ['paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'unpaid', 'unpaid', 'unpaid', 'overdue', 'overdue', 'overdue'];
  const descriptions = ['Monthly hosting', 'Software licenses', 'Cloud infrastructure', 'Consulting Q1', 'Security audit', 'Office supplies', 'Legal retainer', 'Marketing services', 'Data analytics', 'Equipment lease', 'Insurance premium', 'Maintenance contract', 'Development sprint', 'API usage', 'Support contract', 'Bandwidth upgrade', 'Storage expansion', 'Training program'];

  const invoiceRows = invoiceStatuses.map((status, i) => {
    const vendor = vendors[i % vendors.length];
    const amount = rand(2000, 120000).toFixed(2);
    let dueDate: string;
    let paidAt: string | null = null;

    if (status === 'paid') {
      const ago = Math.floor(rand(7, 85));
      dueDate = dateDaysAgo(ago);
      paidAt = daysAgo(ago - Math.floor(rand(0, 3)));
    } else if (status === 'overdue') {
      dueDate = dateDaysAgo(Math.floor(rand(2, 18)));
    } else {
      dueDate = dateDaysFromNow(Math.floor(rand(3, 30)));
    }

    return {
      user_id: userId,
      enterprise_id: enterpriseId,
      erp_config_id: vendor.erp_config_id,
      erp_invoice_id: `INV-TEST-${String(i + 1).padStart(3, '0')}`,
      vendor_id: vendor.id,
      invoice_number: `INV-TEST-${String(i + 1).padStart(3, '0')}`,
      description: descriptions[i],
      amount,
      token: pick(['USDC', 'USDT']),
      chain: pick(['ethereum', 'solana']),
      due_date: dueDate,
      status,
      paid_at: paidAt,
    };
  });

  const { data: invoices } = await supabase
    .from('invoices')
    .insert(invoiceRows)
    .select('id, erp_config_id, amount, token, status');

  // GL postings for paid invoices
  const paidInvoices = invoices?.filter(inv => inv.status === 'paid') || [];
  if (paidInvoices.length) {
    const glRows = paidInvoices.map(inv => ({
      user_id: userId,
      enterprise_id: enterpriseId,
      erp_config_id: inv.erp_config_id,
      invoice_id: inv.id,
      external_gl_id: `GL-TEST-${inv.id.slice(0, 8)}`,
      amount: inv.amount,
      token: inv.token,
      gl_account: pick(['2000-AP', '5000-OPEX', '6000-SGA', '7000-COGS']),
      posted_at: daysAgo(Math.floor(rand(5, 80))),
      status: 'posted',
    }));

    await supabase.from('gl_postings').insert(glRows);
  }

  return {
    erpConfigIds: erps.map(e => e.id),
    vendorIds: vendors.map(v => v.id),
    invoiceIds: invoices?.map(inv => inv.id) || [],
  };
}
