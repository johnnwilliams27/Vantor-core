// src/lib/test-mode/seed/audit.ts
import { SeedContext, daysAgo, randInt, pick } from './helpers';

export async function seedAudit(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const actions = [
    { action: 'login', entity_type: 'session', details: { method: 'credentials' } },
    { action: 'wallet_connect', entity_type: 'wallet', details: { chain: 'ethereum', label: 'Treasury Main' } },
    { action: 'wallet_connect', entity_type: 'wallet', details: { chain: 'solana', label: 'Solana Treasury' } },
    { action: 'payment_create', entity_type: 'payment', details: { amount: '45000', token: 'USDC' } },
    { action: 'payment_approve', entity_type: 'payment', details: { amount: '45000', token: 'USDC' } },
    { action: 'payment_execute', entity_type: 'payment', details: { amount: '45000', token: 'USDC', tx_hash: '0xabc...' } },
    { action: 'swap_execute', entity_type: 'swap', details: { from: 'USDT', to: 'USDC', amount: '100000' } },
    { action: 'invoice_sync', entity_type: 'invoice', details: { erp: 'SAP', count: 5 } },
    { action: 'erp_connect', entity_type: 'erp_configuration', details: { provider: 'sap' } },
    { action: 'erp_connect', entity_type: 'erp_configuration', details: { provider: 'oracle' } },
    { action: 'bank_account_connect', entity_type: 'bank_account', details: { institution: 'JPMorgan Chase' } },
    { action: 'onramp_execute', entity_type: 'fiat_transaction', details: { amount: '500000', token: 'USDC' } },
    { action: 'offramp_execute', entity_type: 'fiat_transaction', details: { amount: '200000', token: 'USDC' } },
    { action: 'settings_update', entity_type: 'treasury_rules', details: { field: 'safety_buffer_multiplier', value: '1.5' } },
    { action: 'treasury_recommendation_approve', entity_type: 'ai_recommendation', details: { action: 'onramp', amount: '350000' } },
    { action: 'treasury_recommendation_reject', entity_type: 'ai_recommendation', details: { action: 'offramp', reason: 'Prefer higher on-chain liquidity' } },
    { action: 'bridge_execute', entity_type: 'bridge_transfer', details: { from: 'ethereum', to: 'solana', amount: '100000' } },
    { action: 'login', entity_type: 'session', details: { method: 'credentials' } },
    { action: 'payment_create', entity_type: 'payment', details: { amount: '12000', token: 'USDC' } },
    { action: 'gl_post', entity_type: 'gl_posting', details: { erp: 'SAP', account: '2000-AP' } },
    { action: 'login', entity_type: 'session', details: { method: 'credentials' } },
    { action: 'swap_execute', entity_type: 'swap', details: { from: 'USDC', to: 'USDT', amount: '50000' } },
    { action: 'bank_balance_refresh', entity_type: 'bank_account', details: { count: 6 } },
    { action: 'payment_execute', entity_type: 'payment', details: { amount: '80000', token: 'USDT' } },
    { action: 'invoice_sync', entity_type: 'invoice', details: { erp: 'Oracle', count: 3 } },
  ];

  const auditRows = actions.map((a, i) => ({
    user_id: userId, enterprise_id: enterpriseId,
    action: a.action, entity_type: a.entity_type, details: a.details,
    ip_address: pick(['192.168.1.100', '10.0.0.1', '172.16.0.50', '203.0.113.42']),
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    created_at: daysAgo(Math.floor((i / actions.length) * 85) + randInt(0, 2)),
  }));

  await supabase.from('audit_logs').insert(auditRows);
}
