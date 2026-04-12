import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_RBAC_SETTINGS,
  resolveRbacSettings,
  updateRbacSettings,
} from './rbac-settings';

/**
 * Uses an in-memory Supabase client fake — enough to verify the
 * upsert+select flow, defaults, partial updates, and error propagation
 * without needing a real Supabase test harness. Pattern mirrors
 * src/lib/insights/settings.test.ts.
 */

interface SettingsRow {
  enterprise_id: string;
  author_approver_separation_enabled: boolean;
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
    if (table !== 'enterprise_rbac_settings') {
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
        return {
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

function createFakeWithUpsertError(msg: string) {
  return createFake([], { upsertError: msg });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('DEFAULT_RBAC_SETTINGS', () => {
  it('defaults author-approver separation to enabled (strict)', () => {
    expect(DEFAULT_RBAC_SETTINGS.authorApproverSeparationEnabled).toBe(true);
  });
});

describe('resolveRbacSettings', () => {
  it('inserts default row and returns defaults for a new enterprise', async () => {
    const fake = createFake();
    const result = await resolveRbacSettings('ent-1', fake.client);

    expect(result).toEqual({
      enterpriseId: 'ent-1',
      authorApproverSeparationEnabled: true,
    });
    expect(fake.rows.get('ent-1')).toEqual({
      enterprise_id: 'ent-1',
      author_approver_separation_enabled: true,
    });
  });

  it('passes onConflict + ignoreDuplicates so concurrent callers do not collide', async () => {
    const fake = createFake();
    await resolveRbacSettings('ent-1', fake.client);
    expect(fake.capturedUpserts[0].opts).toEqual({
      onConflict: 'enterprise_id',
      ignoreDuplicates: true,
    });
  });

  it('returns existing row values when a row already exists (does not overwrite)', async () => {
    const fake = createFake([
      { enterprise_id: 'ent-2', author_approver_separation_enabled: false },
    ]);
    const result = await resolveRbacSettings('ent-2', fake.client);
    expect(result).toEqual({
      enterpriseId: 'ent-2',
      authorApproverSeparationEnabled: false,
    });
    // Still false — upsert was a no-op due to ignoreDuplicates
    expect(fake.rows.get('ent-2')?.author_approver_separation_enabled).toBe(false);
  });

  it('throws a descriptive error when the upsert fails', async () => {
    const fake = createFakeWithUpsertError('permission denied');
    await expect(resolveRbacSettings('ent-3', fake.client)).rejects.toThrow(
      /ent-3.*permission denied/,
    );
  });

  it('throws a descriptive error when the select fails', async () => {
    const fake = createFake([], { selectError: 'connection refused' });
    await expect(resolveRbacSettings('ent-4', fake.client)).rejects.toThrow(
      /ent-4.*connection refused/,
    );
  });
});

describe('updateRbacSettings', () => {
  it('updates the separation flag when patched', async () => {
    const fake = createFake([
      { enterprise_id: 'ent-5', author_approver_separation_enabled: true },
    ]);
    const result = await updateRbacSettings(
      'ent-5',
      { authorApproverSeparationEnabled: false },
      fake.client,
    );
    expect(result.authorApproverSeparationEnabled).toBe(false);
    expect(fake.rows.get('ent-5')?.author_approver_separation_enabled).toBe(false);
  });

  it('returns current settings when the patch is empty', async () => {
    const fake = createFake([
      { enterprise_id: 'ent-6', author_approver_separation_enabled: false },
    ]);
    const result = await updateRbacSettings('ent-6', {}, fake.client);
    expect(result).toEqual({
      enterpriseId: 'ent-6',
      authorApproverSeparationEnabled: false,
    });
  });

  it('lazily creates a default row if the enterprise has never been resolved', async () => {
    const fake = createFake();
    const result = await updateRbacSettings(
      'ent-7',
      { authorApproverSeparationEnabled: false },
      fake.client,
    );
    expect(result.authorApproverSeparationEnabled).toBe(false);
  });
});
