import { describe, it, expect, vi } from 'vitest';
import { loadCounterparty } from './counterparty';

describe('loadCounterparty', () => {
  it('returns undefined when no counterparty id provided', async () => {
    const deps = { fetchCounterpartyHistory: vi.fn() };
    const result = await loadCounterparty('ent-1', undefined, deps);
    expect(result).toBeUndefined();
    expect(deps.fetchCounterpartyHistory).not.toHaveBeenCalled();
  });

  it('returns record with history when fetch succeeds', async () => {
    const lastTime = new Date('2026-04-09T10:00:00Z');
    const deps = {
      fetchCounterpartyHistory: vi.fn().mockResolvedValue({
        id: 'cp-1',
        last_transfer_at: lastTime,
        transfer_count: 5,
        total_volume_usd: '500000',
      }),
    };
    const result = await loadCounterparty('ent-1', 'cp-1', deps);
    expect(result?.id).toBe('cp-1');
    expect(result?.last_transfer_at).toEqual(lastTime);
    expect(result?.transfer_count).toBe(5);
    expect(result?.total_volume_usd).toBe('500000');
    expect(result?.failure).toBeUndefined();
  });

  it('returns minimal record when counterparty is new (fetch returns null)', async () => {
    const deps = { fetchCounterpartyHistory: vi.fn().mockResolvedValue(null) };
    const result = await loadCounterparty('ent-1', 'cp-new', deps);
    expect(result).toEqual({ id: 'cp-new' });
    expect(result?.failure).toBeUndefined();
  });

  it('returns failure field when fetch throws', async () => {
    const deps = {
      fetchCounterpartyHistory: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const result = await loadCounterparty('ent-1', 'cp-1', deps);
    expect(result?.id).toBe('cp-1');
    expect(result?.failure?.reason_code).toBe('counterparty_lookup_failed');
    expect(result?.failure?.human_readable).toContain('db down');
  });

  it('handles non-Error rejection via String()', async () => {
    const deps = {
      fetchCounterpartyHistory: vi.fn().mockRejectedValue('string rejection'),
    };
    const result = await loadCounterparty('ent-1', 'cp-1', deps);
    expect(result?.failure).toBeDefined();
    expect(result?.failure?.human_readable).toContain('string rejection');
  });

  it('passes enterpriseId and counterpartyId to the fetcher', async () => {
    const deps = { fetchCounterpartyHistory: vi.fn().mockResolvedValue(null) };
    await loadCounterparty('ent-7', 'cp-42', deps);
    expect(deps.fetchCounterpartyHistory).toHaveBeenCalledWith('ent-7', 'cp-42');
  });
});
