import { describe, it, expect, vi } from 'vitest';
import { RealForecastQuery } from './real';
import type { ForecastService } from '@/lib/forecast/service';
import type { Obligation as RealObligation } from '@/lib/obligations/types';
import type { ProposedMovement } from '../types/movement';

// These tests cover the shape-translation between the real
// ForecastService (numeric-returning, Obligation-as-DB-row) and the
// policy engine's ForecastQuery contract (AmountNative strings,
// policy-flavored Obligation type). They mock ForecastService so we
// don't need a DB.

function mkService(overrides: Partial<ForecastService> = {}): ForecastService {
  return {
    getProjectedMinBalance: vi
      .fn()
      .mockResolvedValue({ amount: 123.45, date: '2026-05-01' }),
    getProjectedPosition: vi.fn().mockResolvedValue(500),
    areObligationsCovered: vi.fn().mockResolvedValue({ covered: true }),
    getObligationsDueInWindow: vi.fn().mockResolvedValue([]),
    getProjection: vi.fn(),
    hypothetical: vi.fn(),
    ...overrides,
  } as unknown as ForecastService;
}

function mkMovement(
  overrides: Partial<ProposedMovement> = {},
): ProposedMovement {
  return {
    id: 'mv_1',
    kind: 'crypto_transfer',
    amount: { asset: 'USDC', amount: '1000', amount_usd: '1000' },
    source: { venue: 'wallet_1', account_id: null, address: '0xsrc' },
    destination: { venue: 'wallet_2', account_id: null, address: '0xdest' },
    initiator: { type: 'human', user_id: 'u_1' },
    metadata: { enterprise_id: 'ent_1' },
    ...overrides,
  } as unknown as ProposedMovement;
}

function mkRealObligation(
  overrides: Partial<RealObligation> = {},
): RealObligation {
  return {
    id: 'ob_1',
    enterpriseId: 'ent_1',
    userId: 'u_1',
    label: 'Payroll',
    description: null,
    direction: 'outflow',
    amount: 50000,
    currency: 'USD',
    asset: null,
    dueDate: '2026-05-01',
    sourceAccountId: null,
    sourceVenueKind: null,
    confidence: 'confirmed',
    source: 'manual',
    status: 'upcoming',
    recurrence: 'once',
    recurrenceCron: null,
    counterpartyId: null,
    erpReference: null,
    recurringParentId: null,
    tags: [],
    metadata: {},
    paidAt: null,
    settlementTxRef: null,
    isActive: true,
    createdAt: '2026-04-13T00:00:00Z',
    updatedAt: '2026-04-13T00:00:00Z',
    ...overrides,
  };
}

describe('RealForecastQuery', () => {
  it('reports mode="real" in metadata so the trace distinguishes from stub', () => {
    const q = new RealForecastQuery(mkService());
    expect(q.metadata.mode).toBe('real');
    expect(q.metadata.source).toBe('forecast-service');
    expect(q.metadata.warnings).toEqual([]);
  });

  it('converts getProjectedMinBalance number → AmountNative string', async () => {
    const service = mkService();
    const q = new RealForecastQuery(service);
    const res = await q.getProjectedMinBalance('USDC', 'wallet_1', 30);
    expect(service.getProjectedMinBalance).toHaveBeenCalledWith(
      'USDC',
      'wallet_1',
      30,
    );
    expect(res).toEqual({ amount: '123.45', asset: 'USDC' });
  });

  it('converts getProjectedPosition Date → YYYY-MM-DD and number → AmountNative', async () => {
    const service = mkService({
      getProjectedPosition: vi.fn().mockResolvedValue(789.01),
    });
    const q = new RealForecastQuery(service);
    const res = await q.getProjectedPosition(
      'USDT',
      null,
      new Date('2026-06-15T12:34:56Z'),
    );
    expect(service.getProjectedPosition).toHaveBeenCalledWith(
      'USDT',
      null,
      '2026-06-15',
    );
    expect(res).toEqual({ amount: '789.01', asset: 'USDT' });
  });

  it('translates obligation-covered response into ObligationCoverageResult', async () => {
    const service = mkService({
      areObligationsCovered: vi.fn().mockResolvedValue({
        covered: false,
        shortfallAmount: 10000,
        firstShortfallDate: '2026-05-01',
        shortfallAsset: 'USD',
      }),
      getObligationsDueInWindow: vi
        .fn()
        .mockResolvedValue([mkRealObligation(), mkRealObligation({ id: 'ob_2' })]),
    });

    const q = new RealForecastQuery(service);
    const res = await q.areObligationsCovered(30);

    expect(res.covered).toBe(false);
    expect(res.obligations_checked).toBe(2);
    expect(res.obligations_uncovered).toBe(2); // lossy approximation when !covered
    expect(res.shortfall_amount).toEqual({ amount: '10000', currency: 'USD' });
    expect(res.first_shortfall_date).toEqual(new Date('2026-05-01'));
  });

  it('obligations_uncovered=0 when covered=true', async () => {
    const service = mkService({
      areObligationsCovered: vi.fn().mockResolvedValue({ covered: true }),
      getObligationsDueInWindow: vi
        .fn()
        .mockResolvedValue([mkRealObligation(), mkRealObligation({ id: 'ob_2' })]),
    });
    const q = new RealForecastQuery(service);
    const res = await q.areObligationsCovered(30);
    expect(res.covered).toBe(true);
    expect(res.obligations_checked).toBe(2);
    expect(res.obligations_uncovered).toBe(0);
    expect(res.shortfall_amount).toBeUndefined();
    expect(res.first_shortfall_date).toBeUndefined();
  });

  it('maps obligation shapes including source enum', async () => {
    const service = mkService({
      getObligationsDueInWindow: vi.fn().mockResolvedValue([
        mkRealObligation({ id: 'o1', source: 'manual' }),
        mkRealObligation({
          id: 'o2',
          source: 'erp_sync',
          counterpartyId: 'cp_9',
          asset: 'USDC',
        }),
        mkRealObligation({ id: 'o3', source: 'recurring_rule' }),
      ]),
    });
    const q = new RealForecastQuery(service);
    const obs = await q.getObligationsDueInWindow(30);

    expect(obs).toHaveLength(3);
    expect(obs[0].source).toBe('manual');
    expect(obs[1].source).toBe('erp_import');
    expect(obs[2].source).toBe('recurring');
    expect(obs[0].counterparty_id).toBeUndefined();
    expect(obs[1].counterparty_id).toBe('cp_9');
    // Asset falls back to currency when null
    expect(obs[0].amount.currency).toBe('USD');
    expect(obs[1].amount.currency).toBe('USDC');
    expect(obs[0].due_date).toEqual(new Date('2026-05-01'));
    expect(obs[0].description).toBe('Payroll');
  });

  it('hypothetical() translates ProposedMovement → ProposedTransfer and returns a new query', () => {
    const hypoService = mkService();
    const service = mkService({
      hypothetical: vi.fn().mockReturnValue(hypoService),
    });

    const q = new RealForecastQuery(service);
    const movement = mkMovement();
    const hypo = q.hypothetical(movement);

    expect(hypo).not.toBe(q);
    expect(hypo).toBeInstanceOf(RealForecastQuery);
    expect(service.hypothetical).toHaveBeenCalledTimes(1);
    const [transfers] = (service.hypothetical as any).mock.calls[0];
    expect(transfers).toEqual([
      {
        amount: 1000,
        asset: 'USDC',
        fromVenue: 'wallet_1',
        toVenue: 'wallet_2',
      },
    ]);
  });
});
