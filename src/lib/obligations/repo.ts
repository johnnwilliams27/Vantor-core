import type { SupabaseClient } from '@supabase/supabase-js';
import type { Obligation, ObligationInput, ObligationPatch } from './types';

/**
 * Maps a raw `obligations` row (snake_case, numeric strings, nullable TEXT)
 * into the canonical `Obligation` domain shape. Kept private to this module
 * — every exit point from the repo funnels through here so the rest of the
 * codebase never sees raw DB columns.
 *
 * Two things worth watching:
 *   - `amount` comes back as a string from PostgREST because it's NUMERIC(36,6).
 *     We parseFloat it; for Vantor's obligation amounts the precision loss is
 *     acceptable, but any caller doing arithmetic on cents should be aware.
 *   - `tags` and `metadata` default to empty instead of null, matching the
 *     type definition where they are non-optional.
 */
function rowToObligation(r: Record<string, unknown>): Obligation {
  return {
    id: r.id as string,
    enterpriseId: r.enterprise_id as string,
    userId: r.user_id as string,
    label: r.label as string,
    description: (r.description as string | null) ?? null,
    direction: r.direction as Obligation['direction'],
    amount: typeof r.amount === 'string' ? parseFloat(r.amount) : (r.amount as number),
    currency: r.currency as string,
    asset: (r.asset as string | null) ?? null,
    dueDate: r.due_date as string,
    sourceAccountId: (r.source_account_id as string | null) ?? null,
    sourceVenueKind: (r.source_venue_kind as Obligation['sourceVenueKind']) ?? null,
    confidence: r.confidence as Obligation['confidence'],
    source: r.source as Obligation['source'],
    status: r.status as Obligation['status'],
    recurrence: r.recurrence as Obligation['recurrence'],
    recurrenceCron: (r.recurrence_cron as string | null) ?? null,
    counterpartyId: (r.counterparty_id as string | null) ?? null,
    erpReference: (r.erp_reference as string | null) ?? null,
    recurringParentId: (r.recurring_parent_id as string | null) ?? null,
    tags: (r.tags as string[] | null) ?? [],
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    paidAt: (r.paid_at as string | null) ?? null,
    settlementTxRef: (r.settlement_tx_ref as string | null) ?? null,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/**
 * Data-access layer for the `obligations` table. Deliberately dumb: no
 * validation, no recurrence expansion, no forecast math — those live in
 * services that call this repo. The contract is "give me rows, take rows".
 *
 * Every method takes `enterpriseId` as the first argument and scopes the
 * query on it. This is not just for RLS fallback — it's how we enforce
 * tenant isolation at the API layer, where we know the caller's enterprise
 * from the session. Callers MUST NOT pass through a user-supplied enterprise.
 */
export class ObligationsRepo {
  constructor(private db: SupabaseClient) {}

  /**
   * Insert a new obligation. Legacy mirror columns (`amount_usd`,
   * `is_recurring`) are written alongside the v2 columns because migration
   * 0036 kept them as NOT NULL for backwards-compat; the deprecation tags in
   * the SQL mean they'll be dropped in a later migration, at which point this
   * method can be simplified.
   */
  async create(enterpriseId: string, userId: string, input: ObligationInput): Promise<Obligation> {
    const recurrence = input.recurrence ?? 'once';
    const row = {
      enterprise_id: enterpriseId,
      user_id: userId,
      label: input.label,
      description: input.description ?? null,
      direction: input.direction,
      amount: input.amount,
      // Legacy mirror: amount_usd is still NOT NULL in the schema. For USD
      // obligations we copy the native amount straight across; for non-USD we
      // fall back to the same numeric value rather than null (the column is
      // NOT NULL and we don't have an FX lookup in this layer).
      amount_usd: input.amount,
      currency: input.currency,
      asset: input.asset ?? null,
      due_date: input.dueDate,
      source_account_id: input.sourceAccountId ?? null,
      source_venue_kind: input.sourceVenueKind ?? null,
      confidence: input.confidence ?? 'confirmed',
      source: input.source ?? 'manual',
      recurrence,
      recurrence_cron: input.recurrenceCron ?? null,
      counterparty_id: input.counterpartyId ?? null,
      erp_reference: input.erpReference ?? null,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      // Legacy mirror: kept in sync with the recurrence enum until the column
      // is dropped. The forecast engine reads recurrence, not is_recurring.
      is_recurring: recurrence !== 'once',
    };
    const { data, error } = await this.db.from('obligations').insert(row).select('*').single();
    if (error) throw new Error(`ObligationsRepo.create failed: ${error.message}`);
    return rowToObligation(data);
  }

  async getById(enterpriseId: string, id: string): Promise<Obligation> {
    const { data, error } = await this.db
      .from('obligations')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`ObligationsRepo.getById failed: ${error.message}`);
    if (!data) throw new Error(`Obligation ${id} not found`);
    return rowToObligation(data);
  }

  /**
   * Fetches all upcoming obligations whose due date falls in the [from, to]
   * inclusive window. Dates are passed as JS Date but reduced to YYYY-MM-DD
   * because `due_date` is a DATE (no timezone). Using toISOString().slice(0,10)
   * is safe only for UTC-normalized inputs — callers outside Node should
   * normalize first.
   */
  async listUpcoming(enterpriseId: string, from: Date, to: Date): Promise<Obligation[]> {
    const { data, error } = await this.db
      .from('obligations')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .eq('status', 'upcoming')
      .gte('due_date', from.toISOString().slice(0, 10))
      .lte('due_date', to.toISOString().slice(0, 10))
      .order('due_date');
    if (error) throw new Error(`ObligationsRepo.listUpcoming failed: ${error.message}`);
    return (data ?? []).map(rowToObligation);
  }

  /**
   * Everything the tenant has that's still considered "live" — includes
   * upcoming, paid, missed. Used by recurrence materialization and by the
   * forecast engine's "baseline" obligation lookup.
   */
  async listAllActive(enterpriseId: string): Promise<Obligation[]> {
    const { data, error } = await this.db
      .from('obligations')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .eq('is_active', true);
    if (error) throw new Error(`ObligationsRepo.listAllActive failed: ${error.message}`);
    return (data ?? []).map(rowToObligation);
  }

  /**
   * Partial update. We translate camelCase → snake_case explicitly so that
   * callers can't inject unknown columns. `updated_at` is bumped manually
   * (no DB trigger) — if we add one later this explicit stamp becomes
   * harmless dead code but still protects tests that assert on it.
   *
   * Legacy mirrors: when `amount` or `recurrence` are patched we mirror into
   * `amount_usd` / `is_recurring` so the legacy columns stay consistent.
   */
  async patch(enterpriseId: string, id: string, patch: ObligationPatch): Promise<Obligation> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.label !== undefined) update.label = patch.label;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.direction !== undefined) update.direction = patch.direction;
    if (patch.amount !== undefined) {
      update.amount = patch.amount;
      update.amount_usd = patch.amount; // keep legacy mirror in sync
    }
    if (patch.currency !== undefined) update.currency = patch.currency;
    if (patch.asset !== undefined) update.asset = patch.asset;
    if (patch.dueDate !== undefined) update.due_date = patch.dueDate;
    if (patch.sourceAccountId !== undefined) update.source_account_id = patch.sourceAccountId;
    if (patch.sourceVenueKind !== undefined) update.source_venue_kind = patch.sourceVenueKind;
    if (patch.confidence !== undefined) update.confidence = patch.confidence;
    if (patch.recurrence !== undefined) {
      update.recurrence = patch.recurrence;
      update.is_recurring = patch.recurrence !== 'once'; // legacy mirror
    }
    if (patch.recurrenceCron !== undefined) update.recurrence_cron = patch.recurrenceCron;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.paidAt !== undefined) update.paid_at = patch.paidAt;
    if (patch.settlementTxRef !== undefined) update.settlement_tx_ref = patch.settlementTxRef;
    if (patch.tags !== undefined) update.tags = patch.tags;
    if (patch.metadata !== undefined) update.metadata = patch.metadata;

    const { data, error } = await this.db
      .from('obligations')
      .update(update)
      .eq('enterprise_id', enterpriseId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`ObligationsRepo.patch failed: ${error.message}`);
    if (!data) throw new Error(`Patch failed for ${id}: not found`);
    return rowToObligation(data);
  }

  /**
   * Convenience wrapper around patch() that encodes the "obligation settled"
   * transition as a single call. The settlement ref is opaque to this layer
   * — it might be a Dwolla transfer id, a Circle redemption id, or an
   * on-chain tx hash. Callers stash whatever uniquely identifies the payment.
   */
  async markPaid(enterpriseId: string, id: string, settlementRef: string): Promise<Obligation> {
    return this.patch(enterpriseId, id, {
      status: 'paid',
      paidAt: new Date().toISOString(),
      settlementTxRef: settlementRef,
    });
  }

  async delete(enterpriseId: string, id: string): Promise<void> {
    const { error } = await this.db
      .from('obligations')
      .delete()
      .eq('enterprise_id', enterpriseId)
      .eq('id', id);
    if (error) throw new Error(`ObligationsRepo.delete failed: ${error.message}`);
  }
}
