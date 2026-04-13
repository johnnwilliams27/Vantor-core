import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { upsertObligationFromInvoice } from '@/lib/obligations/sync-from-invoice';

describe('upsertObligationFromInvoice', () => {
  const db = getTestDb();
  let enterpriseId: string;
  let userId: string;
  let invoiceId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    userId = ctx.userId;
    cleanup = ctx.cleanup;

    const { data: inv } = await db
      .from('invoices')
      .insert({
        user_id: userId,
        enterprise_id: enterpriseId,
        invoice_number: 'TEST-001',
        description: 'Vendor software',
        amount: '5000',
        token: 'USDC',
        chain: 'ethereum',
        direction: 'outflow',
        due_date: '2026-05-30',
        status: 'unpaid',
      })
      .select('id')
      .single();
    invoiceId = inv!.id as string;
  });

  afterAll(async () => {
    await cleanup();
  });

  it('creates an obligation row linked via source_ref_id', async () => {
    const out = await upsertObligationFromInvoice(db, {
      id: invoiceId,
      user_id: userId,
      enterprise_id: enterpriseId,
      invoice_number: 'TEST-001',
      description: 'Vendor software',
      amount: '5000',
      token: 'USDC',
      chain: 'ethereum',
      direction: 'outflow',
      due_date: '2026-05-30',
      status: 'unpaid',
    });
    expect(out.ok).toBe(true);

    const { data: obl } = await db
      .from('obligations')
      .select('label, amount, currency, direction, source, source_ref_id, status, is_active')
      .eq('source_ref_id', invoiceId)
      .maybeSingle();

    expect(obl).toBeTruthy();
    expect(obl!.label).toBe('Invoice TEST-001');
    expect(Number(obl!.amount)).toBe(5000);
    expect(obl!.currency).toBe('USDC');
    expect(obl!.direction).toBe('outflow');
    expect(obl!.source).toBe('erp_sync');
    expect(obl!.status).toBe('upcoming');
    expect(obl!.is_active).toBe(true);
  });

  it('idempotent: calling again updates in place (no duplicate)', async () => {
    // Second call, invoice now marked paid
    const out = await upsertObligationFromInvoice(db, {
      id: invoiceId,
      user_id: userId,
      enterprise_id: enterpriseId,
      invoice_number: 'TEST-001',
      description: 'Vendor software',
      amount: '5000',
      token: 'USDC',
      chain: 'ethereum',
      direction: 'outflow',
      due_date: '2026-05-30',
      status: 'paid',
    });
    expect(out.ok).toBe(true);

    const { data: rows } = await db
      .from('obligations')
      .select('id, status, is_active, paid_at')
      .eq('source_ref_id', invoiceId);

    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe('paid');
    expect(rows![0].is_active).toBe(false);
    expect(rows![0].paid_at).not.toBeNull();
  });

  it('inflow direction (AR invoice) passes through', async () => {
    const { data: arInv } = await db
      .from('invoices')
      .insert({
        user_id: userId,
        enterprise_id: enterpriseId,
        invoice_number: 'AR-001',
        amount: '10000',
        token: 'USDC',
        chain: 'ethereum',
        direction: 'inflow',
        due_date: '2026-06-15',
        status: 'unpaid',
      })
      .select('id')
      .single();

    const out = await upsertObligationFromInvoice(db, {
      id: arInv!.id as string,
      user_id: userId,
      enterprise_id: enterpriseId,
      invoice_number: 'AR-001',
      description: null,
      amount: '10000',
      token: 'USDC',
      chain: 'ethereum',
      direction: 'inflow',
      due_date: '2026-06-15',
      status: 'unpaid',
    });
    expect(out.ok).toBe(true);

    const { data: obl } = await db
      .from('obligations')
      .select('direction')
      .eq('source_ref_id', arInv!.id)
      .maybeSingle();
    expect(obl!.direction).toBe('inflow');
  });

  it('missing due_date falls back to today+30', async () => {
    const { data: noDateInv } = await db
      .from('invoices')
      .insert({
        user_id: userId,
        enterprise_id: enterpriseId,
        invoice_number: 'NO-DATE-001',
        amount: '100',
        token: 'USDC',
        chain: 'ethereum',
        direction: 'outflow',
        status: 'unpaid',
      })
      .select('id')
      .single();

    const out = await upsertObligationFromInvoice(db, {
      id: noDateInv!.id as string,
      user_id: userId,
      enterprise_id: enterpriseId,
      invoice_number: 'NO-DATE-001',
      description: null,
      amount: '100',
      token: 'USDC',
      chain: 'ethereum',
      direction: 'outflow',
      due_date: null,
      status: 'unpaid',
    });
    expect(out.ok).toBe(true);

    const { data: obl } = await db
      .from('obligations')
      .select('due_date')
      .eq('source_ref_id', noDateInv!.id)
      .maybeSingle();
    // Just assert it's a valid future date; the fallback is today+30.
    const dueDate = new Date(obl!.due_date as string);
    const today = new Date();
    expect(dueDate.getTime()).toBeGreaterThan(today.getTime());
  });
});
