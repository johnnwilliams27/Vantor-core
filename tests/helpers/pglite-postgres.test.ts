import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestPostgres, type TestDb } from './pglite-postgres';

describe('startTestPostgres (pglite-backed)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestPostgres();
  }, 30_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it('applies the bootstrap schema and creates erp_configurations.xero_tenant_id', async () => {
    const res = await db.client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'erp_configurations' AND column_name = 'xero_tenant_id'
    `);
    expect(res.rowCount).toBe(1);
  });

  it('creates bill_payments with the right columns', async () => {
    const res = await db.client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bill_payments'
      ORDER BY ordinal_position
    `);
    const names = res.rows.map((r) => r.column_name);
    expect(names).toContain('external_tx_hash');
    expect(names).toContain('invoice_id');
    expect(names).toContain('currency');
  });

  it('does not create gl_postings', async () => {
    const res = await db.client.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'gl_postings'
    `);
    expect(res.rowCount).toBe(0);
  });

  it('supports parameterized queries and FK cascades', async () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    await db.client.query(`INSERT INTO user_profiles (id) VALUES ($1)`, [userId]);
    await db.client.query(`
      INSERT INTO erp_configurations (user_id, provider, credentials, xero_tenant_id, access_token_expires_at, status)
      VALUES ($1, 'xero', 'encrypted-blob', 'tenant-1', now(), 'active')
    `, [userId]);
    const before = await db.client.query(`SELECT COUNT(*)::int AS n FROM erp_configurations`);
    expect(before.rows[0].n).toBe(1);

    await db.client.query(`DELETE FROM user_profiles WHERE id = $1`, [userId]);
    const after = await db.client.query(`SELECT COUNT(*)::int AS n FROM erp_configurations`);
    expect(after.rows[0].n).toBe(0); // cascade deleted
  });
});
