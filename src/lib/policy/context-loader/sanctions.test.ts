import { describe, it, expect, vi } from 'vitest';
import { loadSanctions } from './sanctions';

describe('loadSanctions', () => {
  it('returns unscreened status when no counterparty id provided', async () => {
    const deps = { fetchLatestScreening: vi.fn() };
    const result = await loadSanctions('ent-1', undefined, deps);
    expect(result).toEqual({ status: 'unscreened' });
    expect(result.failure).toBeUndefined();
    expect(deps.fetchLatestScreening).not.toHaveBeenCalled();
  });

  it('returns the latest screening when fetch succeeds (clear)', async () => {
    const screenedAt = new Date('2026-04-09T10:00:00Z');
    const deps = {
      fetchLatestScreening: vi.fn().mockResolvedValue({
        counterparty_id: 'cp-1',
        result: 'clear',
        screened_at: screenedAt,
      }),
    };
    const result = await loadSanctions('ent-1', 'cp-1', deps);
    expect(result.counterparty_id).toBe('cp-1');
    expect(result.status).toBe('clear');
    expect(result.screened_at).toEqual(screenedAt);
    expect(result.failure).toBeUndefined();
  });

  it('returns the latest screening when fetch succeeds (sanctioned)', async () => {
    const deps = {
      fetchLatestScreening: vi.fn().mockResolvedValue({
        counterparty_id: 'cp-1',
        result: 'sanctioned',
        screened_at: new Date(),
      }),
    };
    const result = await loadSanctions('ent-1', 'cp-1', deps);
    expect(result.status).toBe('sanctioned');
  });

  it('returns unscreened when counterparty has no screening record', async () => {
    const deps = { fetchLatestScreening: vi.fn().mockResolvedValue(null) };
    const result = await loadSanctions('ent-1', 'cp-new', deps);
    expect(result.counterparty_id).toBe('cp-new');
    expect(result.status).toBe('unscreened');
    expect(result.failure).toBeUndefined();
  });

  it('returns failure field when fetch throws (fail-closed for sanctions_status leaf)', async () => {
    const deps = {
      fetchLatestScreening: vi.fn().mockRejectedValue(new Error('screening svc down')),
    };
    const result = await loadSanctions('ent-1', 'cp-1', deps);
    expect(result.counterparty_id).toBe('cp-1');
    expect(result.status).toBe('unscreened'); // safe fallback value
    expect(result.failure?.reason_code).toBe('sanctions_status_unavailable');
    expect(result.failure?.human_readable).toContain('screening svc down');
  });

  it('handles non-Error rejection via String()', async () => {
    const deps = { fetchLatestScreening: vi.fn().mockRejectedValue('string rejection') };
    const result = await loadSanctions('ent-1', 'cp-1', deps);
    expect(result.failure).toBeDefined();
    expect(result.failure?.human_readable).toContain('string rejection');
  });
});
