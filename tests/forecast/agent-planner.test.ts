import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { persistAgentPlannerForecast } from '@/lib/forecast/agent-planner';
import type { RulesEngineResult } from '@/lib/treasury/interface';

function fakeResult(overrides: Partial<RulesEngineResult> = {}): RulesEngineResult {
  return {
    snapshot: {} as RulesEngineResult['snapshot'],
    obligationsInWindow: [],
    totalObligationsUsd: 0,
    safetyBufferTargetUsd: 0,
    surplusUsd: 50000,
    action: 'onramp',
    recommendedAmountUsd: 50000,
    requiresApproval: true,
    targetBankAccountId: 'ba-stub',
    targetStablecoinToken: 'USDC',
    targetChain: 'ethereum',
    lookaheadDays: 30,
    ...overrides,
  };
}

describe('persistAgentPlannerForecast', () => {
  const db = getTestDb();
  let enterpriseId: string;
  let userId: string;
  let bankAccountId: string;
  let walletId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    userId = ctx.userId;
    cleanup = ctx.cleanup;

    const { data: bank } = await db
      .from('bank_accounts')
      .insert({
        user_id: userId,
        enterprise_id: enterpriseId,
        institution_name: 'Test Bank',
        account_name: 'Ops',
        last4: '0001',
        currency: 'USD',
      })
      .select('id')
      .single();
    bankAccountId = bank!.id as string;

    const { data: wallet } = await db
      .from('wallets')
      .insert({
        user_id: userId,
        enterprise_id: enterpriseId,
        chain: 'ethereum',
        address: '0x0000000000000000000000000000000000000001',
        label: 'Test wallet',
      })
      .select('id')
      .single();
    walletId = wallet!.id as string;
  });

  afterAll(async () => {
    await cleanup();
  });

  it('no_action → skips snapshot persistence', async () => {
    const out = await persistAgentPlannerForecast({
      supabase: db,
      enterpriseId,
      recommendationId: 'rec-noop',
      result: fakeResult({ action: 'no_action', recommendedAmountUsd: null }),
      actorId: userId,
    });
    expect(out).toEqual({ persisted: false, reason: 'no_action' });
  });

  it('no matching wallet on chain → returns no_wallet without persisting', async () => {
    const before = await db
      .from('forecast_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('enterprise_id', enterpriseId);

    const out = await persistAgentPlannerForecast({
      supabase: db,
      enterpriseId,
      recommendationId: 'rec-no-wallet',
      result: fakeResult({ targetChain: 'solana', targetBankAccountId: bankAccountId }),
      actorId: userId,
    });
    expect(out).toEqual({ persisted: false, reason: 'no_wallet' });

    const after = await db
      .from('forecast_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('enterprise_id', enterpriseId);
    expect(after.count).toBe(before.count);
  });

  it('onramp with wallet → persists snapshot with is_hypothetical=true, agent_planner consumer, correlation_id, and both-leg hypothetical_actions', async () => {
    const recId = `rec-${Date.now()}`;
    const out = await persistAgentPlannerForecast({
      supabase: db,
      enterpriseId,
      recommendationId: recId,
      result: fakeResult({
        action: 'onramp',
        recommendedAmountUsd: 25000,
        targetBankAccountId: bankAccountId,
        targetChain: 'ethereum',
        targetStablecoinToken: 'USDC',
      }),
      actorId: userId,
    });
    expect(out).toEqual({ persisted: true });

    const { data: snap } = await db
      .from('forecast_snapshots')
      .select('consumer, is_hypothetical, hypothetical_actions, correlation_id, enterprise_id')
      .eq('correlation_id', recId)
      .maybeSingle();

    expect(snap).toBeTruthy();
    expect(snap!.enterprise_id).toBe(enterpriseId);
    expect(snap!.consumer).toBe('agent_planner');
    expect(snap!.is_hypothetical).toBe(true);
    const actions = snap!.hypothetical_actions as Array<{
      amount: number;
      asset: string;
      fromVenue: string | null;
      toVenue: string | null;
    }>;
    expect(actions).toHaveLength(2);
    // Leg 1: USD leaves bank
    expect(actions[0]).toMatchObject({ amount: 25000, asset: 'USD', fromVenue: bankAccountId, toVenue: null });
    // Leg 2: stablecoin arrives at wallet
    expect(actions[1]).toMatchObject({ amount: 25000, asset: 'USDC', fromVenue: null, toVenue: walletId });
  });

  it('offramp with wallet → legs reversed (stablecoin out of wallet, USD into bank)', async () => {
    const recId = `rec-off-${Date.now()}`;
    await persistAgentPlannerForecast({
      supabase: db,
      enterpriseId,
      recommendationId: recId,
      result: fakeResult({
        action: 'offramp',
        recommendedAmountUsd: 10000,
        targetBankAccountId: bankAccountId,
        targetChain: 'ethereum',
        targetStablecoinToken: 'USDC',
      }),
      actorId: userId,
    });

    const { data: snap } = await db
      .from('forecast_snapshots')
      .select('hypothetical_actions')
      .eq('correlation_id', recId)
      .maybeSingle();
    const actions = snap!.hypothetical_actions as Array<{
      amount: number;
      asset: string;
      fromVenue: string | null;
      toVenue: string | null;
    }>;
    expect(actions[0]).toMatchObject({ amount: 10000, asset: 'USDC', fromVenue: walletId, toVenue: null });
    expect(actions[1]).toMatchObject({ amount: 10000, asset: 'USD', fromVenue: null, toVenue: bankAccountId });
  });
});
