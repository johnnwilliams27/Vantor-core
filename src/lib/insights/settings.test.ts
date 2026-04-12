import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_INSIGHT_SETTINGS,
  resolveInsightSettings,
  updateInsightSettings,
} from './settings';
import type { RiskProfileId, AumTier } from './types';

/**
 * Tests for the per-enterprise insight settings resolver.
 *
 * Uses an in-memory Supabase client fake — enough to verify the
 * upsert+select flow, default values, partial updates, and error
 * propagation without needing a real Supabase test harness.
 */

// ─── In-memory fake Supabase client ──────────────────────────────────

interface SettingsRow {
  enterprise_id: string;
  risk_profile_id: RiskProfileId;
  aum_tier: AumTier;
}

interface FakeOpts {
  upsertError?: string;
  selectError?: string;
  updateError?: string;
}

function createFake(initial: SettingsRow[] = [], opts: FakeOpts = {}) {
  const rows = new Map<string, SettingsRow>(initial.map((r) => [r.enterprise_id, r]));
  const capturedUpserts: Array<{ payload: Partial<SettingsRow>; opts: unknown }> = [];

  function from(table: string) {
    if (table !== 'customer_insight_settings') {
      throw new Error(`unexpected table: ${table}`);
    }
    return {
      upsert(payload: SettingsRow, upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        capturedUpserts.push({ payload, opts: upsertOpts });
        if (opts.upsertError) {
          return Promise.resolve({ error: { message: opts.upsertError } });
        }
        const ignore = upsertOpts?.ignoreDuplicates && rows.has(payload.enterprise_id);
        if (!ignore) rows.set(payload.enterprise_id, payload);
        return Promise.resolve({ error: null });
      },
      select(_cols: string) {
        const builder = {
          eq(_col: string, val: string) {
            return {
              single() {
                if (opts.selectError) {
                  return Promise.resolve({ data: null, error: { message: opts.selectError } });
                }
                const row = rows.get(val);
                if (!row) {
                  return Promise.resolve({ data: null, error: { message: 'row not found' } });
                }
                return Promise.resolve({ data: row, error: null });
              },
            };
          },
        };
        return builder;
      },
      update(patch: Partial<SettingsRow>) {
        return {
          eq(_col: string, val: string) {
            return {
              select(_cols: string) {
                return {
                  single() {
                    if (opts.updateError) {
                      return Promise.resolve({ data: null, error: { message: opts.updateError } });
                    }
                    const existing = rows.get(val);
                    if (!existing) {
                      return Promise.resolve({ data: null, error: { message: 'row not found' } });
                    }
                    const updated = { ...existing, ...patch };
                    rows.set(val, updated);
                    return Promise.resolve({ data: updated, error: null });
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  return {
    client: { from } as unknown as SupabaseClient,
    rows,
    capturedUpserts,
  };
}

// Convenience: build a fake that fails every upsert with the given message.
function createFakeWithUpsertError(msg: string) {
  return createFake([], { upsertError: msg });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('DEFAULT_INSIGHT_SETTINGS', () => {
  it('uses balanced risk profile + scale AUM tier as v1 defaults', () => {
    expect(DEFAULT_INSIGHT_SETTINGS.riskProfileId).toBe('balanced');
    expect(DEFAULT_INSIGHT_SETTINGS.aumTier).toBe('scale');
  });
});

describe('resolveInsightSettings', () => {
  it('inserts default row and returns defaults for a new enterprise', async () => {
    const fake = createFake();
    const result = await resolveInsightSettings('ent-1', fake.client);

    expect(result).toEqual({
      enterpriseId: 'ent-1',
      riskProfileId: 'balanced',
      aumTier: 'scale',
    });
    expect(fake.rows.get('ent-1')).toEqual({
      enterprise_id: 'ent-1',
      risk_profile_id: 'balanced',
      aum_tier: 'scale',
    });
  });

  it('passes onConflict + ignoreDuplicates so concurrent callers do not collide', async () => {
    const fake = createFake();
    await resolveInsightSettings('ent-1', fake.client);

    expect(fake.capturedUpserts).toHaveLength(1);
    expect(fake.capturedUpserts[0].opts).toEqual({
      onConflict: 'enterprise_id',
      ignoreDuplicates: true,
    });
  });

  it('returns existing row values, not defaults, when a row already exists', async () => {
    const fake = createFake([
      { enterprise_id: 'ent-2', risk_profile_id: 'conservative', aum_tier: 'enterprise' },
    ]);

    const result = await resolveInsightSettings('ent-2', fake.client);

    expect(result).toEqual({
      enterpriseId: 'ent-2',
      riskProfileId: 'conservative',
      aumTier: 'enterprise',
    });
    // Upsert was called (ignoreDuplicates means it's a no-op), but the row
    // was preserved, not overwritten.
    expect(fake.rows.get('ent-2')?.risk_profile_id).toBe('conservative');
  });

  it('throws a descriptive error when the upsert fails', async () => {
    const fake = createFakeWithUpsertError('permission denied for customer_insight_settings');
    await expect(resolveInsightSettings('ent-3', fake.client)).rejects.toThrow(
      /ent-3.*permission denied/,
    );
  });

  it('throws a descriptive error when the select fails', async () => {
    const fake = createFake([], { selectError: 'connection refused' });
    await expect(resolveInsightSettings('ent-4', fake.client)).rejects.toThrow(
      /ent-4.*connection refused/,
    );
  });
});

describe('updateInsightSettings', () => {
  it('updates only riskProfileId when that is the only field patched', async () => {
    const fake = createFake([
      { enterprise_id: 'ent-5', risk_profile_id: 'balanced', aum_tier: 'scale' },
    ]);

    const result = await updateInsightSettings(
      'ent-5',
      { riskProfileId: 'growth' },
      fake.client,
    );

    expect(result.riskProfileId).toBe('growth');
    expect(result.aumTier).toBe('scale'); // unchanged
  });

  it('updates only aumTier when that is the only field patched', async () => {
    const fake = createFake([
      { enterprise_id: 'ent-6', risk_profile_id: 'balanced', aum_tier: 'scale' },
    ]);

    const result = await updateInsightSettings(
      'ent-6',
      { aumTier: 'starter' },
      fake.client,
    );

    expect(result.riskProfileId).toBe('balanced'); // unchanged
    expect(result.aumTier).toBe('starter');
  });

  it('updates both fields when both are patched', async () => {
    const fake = createFake([
      { enterprise_id: 'ent-7', risk_profile_id: 'balanced', aum_tier: 'scale' },
    ]);

    const result = await updateInsightSettings(
      'ent-7',
      { riskProfileId: 'conservative', aumTier: 'enterprise' },
      fake.client,
    );

    expect(result).toEqual({
      enterpriseId: 'ent-7',
      riskProfileId: 'conservative',
      aumTier: 'enterprise',
    });
  });

  it('returns current settings when the patch is empty', async () => {
    const fake = createFake([
      { enterprise_id: 'ent-8', risk_profile_id: 'growth', aum_tier: 'starter' },
    ]);

    const result = await updateInsightSettings('ent-8', {}, fake.client);

    expect(result).toEqual({
      enterpriseId: 'ent-8',
      riskProfileId: 'growth',
      aumTier: 'starter',
    });
  });

  it('lazily creates a default row if the enterprise has never been resolved', async () => {
    const fake = createFake();
    const result = await updateInsightSettings(
      'ent-9',
      { riskProfileId: 'conservative' },
      fake.client,
    );

    expect(result.riskProfileId).toBe('conservative');
    expect(result.aumTier).toBe('scale'); // default applied during lazy resolve
  });
});
