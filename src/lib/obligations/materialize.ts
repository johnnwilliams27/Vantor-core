import type { SupabaseClient } from '@supabase/supabase-js';
import { ObligationsRepo } from './repo';
import { expandRecurrence } from './recurrence';

/**
 * How far ahead we materialize recurring obligations. Each nightly run
 * expands every active recurring parent up to this horizon, skipping
 * any (parent_id, due_date) pair that's already on disk.
 */
const HORIZON_DAYS = 90;

/**
 * Materialize recurring obligation instances into the `obligations`
 * table for a single enterprise.
 *
 * This is idempotent by design: running it twice in a row produces
 * zero new rows on the second invocation. Idempotency comes from a
 * `(recurring_parent_id, due_date)` pre-check against existing rows,
 * plus explicitly skipping any instance whose due_date equals the
 * parent's own dueDate (the parent row itself is already in place).
 *
 * Called by `/api/cron/materialize-obligations` once per enterprise
 * per day.
 *
 * Returns the ids of newly-created child rows.
 */
export async function materializeRecurringObligations(
  db: SupabaseClient,
  enterpriseId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const repo = new ObligationsRepo(db);
  const active = await repo.listAllActive(enterpriseId);
  // Only parent rules are expanded — materialized instances themselves
  // are `recurrence: 'once'` with a non-null `recurringParentId` and
  // must not be re-expanded.
  const parents = active.filter(
    (o) => o.recurrence !== 'once' && o.recurringParentId === null,
  );

  // UTC-anchored window to match the ForecastEngine's date semantics
  // (see src/lib/forecast/engine.ts). `setHours` would drift in
  // non-UTC server environments.
  const from = new Date(now);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  // One query to find every existing materialized instance for this
  // enterprise — keyed by (parent_id, due_date) for O(1) lookup.
  const { data: existing, error: existingErr } = await db
    .from('obligations')
    .select('recurring_parent_id, due_date')
    .eq('enterprise_id', enterpriseId)
    .not('recurring_parent_id', 'is', null);
  if (existingErr) throw existingErr;

  const existingKey = new Set<string>();
  for (const r of (existing ?? []) as Array<{
    recurring_parent_id: string;
    due_date: string;
  }>) {
    existingKey.add(`${r.recurring_parent_id}|${r.due_date}`);
  }

  const created: string[] = [];

  for (const parent of parents) {
    const instances = expandRecurrence(parent, from, to);
    for (const inst of instances) {
      if (inst.dueDate === parent.dueDate) continue;
      const key = `${parent.id}|${inst.dueDate}`;
      if (existingKey.has(key)) continue;

      const { data, error } = await db
        .from('obligations')
        .insert({
          enterprise_id: enterpriseId,
          user_id: parent.userId,
          label: parent.label,
          description: parent.description,
          direction: parent.direction,
          amount: inst.amount,
          // Legacy NOT NULL mirror — matches the convention used in
          // ObligationsRepo.create (T4). See the note in repo.ts on
          // why this intentionally doesn't FX-convert.
          amount_usd: inst.amount,
          currency: parent.currency,
          asset: parent.asset,
          due_date: inst.dueDate,
          source_account_id: parent.sourceAccountId,
          source_venue_kind: parent.sourceVenueKind,
          confidence: parent.confidence,
          source: 'recurring_rule',
          status: 'upcoming',
          recurrence: 'once',
          recurring_parent_id: parent.id,
          counterparty_id: parent.counterpartyId,
          erp_reference: parent.erpReference,
          tags: parent.tags,
          metadata: parent.metadata,
          is_recurring: false,
        })
        .select('id')
        .single();
      if (error) throw error;
      if (data) {
        created.push(data.id as string);
        existingKey.add(key); // guard against same-run double-insert
      }
    }
  }

  return created;
}
