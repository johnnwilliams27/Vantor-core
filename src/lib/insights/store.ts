/**
 * Persistence layer for the Treasury Insights Engine.
 *
 * Handles insert/read/transition of insight rows in the `treasury_insights`
 * table. Dedup and cooldown are enforced HERE, not in the detectors —
 * detectors produce insights freely and the store decides whether a given
 * insight is new, stale, or suppressed by a cooldown.
 *
 * Every state transition writes to `audit_logs` via `writeAuditLog`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import type {
  DetectedInsight,
  InsightState,
  InsightType,
  PolicyVerdict,
  TreasuryInsightRow,
} from './types';

// ─── Cooldown windows ─────────────────────────────────────────────────

/**
 * Default cooldown windows by insight type (in hours). Dismissing an
 * insight locks its dedup_key for this long to prevent the cron from
 * immediately re-creating it. Tunable per-detector if needed.
 *
 * Exported so unit tests can assert coverage (every `InsightType` has a
 * cooldown) without touching the DB.
 */
export const DEFAULT_COOLDOWN_HOURS: Record<InsightType, number> = {
  liquidity_below_buffer: 6,    // critical — short cooldown, re-surface quickly
  liquidity_idle_cash: 72,      // informational — dismiss for 3 days
  yield_drop: 24,
  yield_opportunity: 48,
  yield_idle_opportunity: 72,
  concentration_warning: 48,
  concentration_breach: 12,     // higher-severity — shorter cooldown
};

// ─── Persistence inputs ───────────────────────────────────────────────

export interface CreateInsightInput {
  enterpriseId: string;
  userId: string;
  detectorName: string;
  detected: DetectedInsight;
  /** Policy verdict from the stub or real policy engine. Null if not actionable. */
  policyVerdict: PolicyVerdict | null;
  policyReason: string | null;
  /** AI reasoning (Claude-generated) — only for critical insights in cron path. */
  aiReasoning?: string;
  aiModel?: string;
}

export interface StoredInsight extends TreasuryInsightRow {}

// ─── Dedup check ──────────────────────────────────────────────────────

/**
 * Returns true if an insight with the same dedup_key is currently active
 * (state 'new' or 'viewed') OR is in a cooldown window. The cron orchestrator
 * calls this before creating a new insight to avoid notification spam.
 */
export async function isDuplicate(
  supabase: SupabaseClient,
  enterpriseId: string,
  userId: string,
  dedupKey: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('treasury_insights')
    .select('id, state, cooldown_until')
    .eq('enterprise_id', enterpriseId)
    .eq('user_id', userId)
    .eq('dedup_key', dedupKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return false;

  // Active insight — definitely duplicate
  if (data.state === 'new' || data.state === 'viewed') return true;

  // Dismissed or expired but still in cooldown window
  if (data.cooldown_until) {
    const cooldownEnd = new Date(data.cooldown_until as string);
    if (cooldownEnd > new Date()) return true;
  }

  return false;
}

// ─── Create ───────────────────────────────────────────────────────────

/**
 * Persist a new insight. Returns null if the insight is a duplicate
 * (same dedup_key already active or in cooldown).
 *
 * Writes `insight_create` to audit_logs on success.
 */
export async function createInsight(
  input: CreateInsightInput,
  supabase: SupabaseClient = createAdminClient(),
): Promise<StoredInsight | null> {
  const { enterpriseId, userId, detectorName, detected, policyVerdict, policyReason } = input;

  // Dedup check
  if (await isDuplicate(supabase, enterpriseId, userId, detected.dedupKey)) {
    return null;
  }

  const { data, error } = await supabase
    .from('treasury_insights')
    .insert({
      enterprise_id: enterpriseId,
      user_id: userId,
      detector_name: detectorName,
      insight_type: detected.type,
      severity: detected.severity,
      state: 'new',
      title: detected.title,
      summary: detected.summary,
      ai_reasoning: input.aiReasoning ?? null,
      ai_model: input.aiModel ?? null,
      rationale: detected.rationale,
      recommended_action: detected.recommendedAction,
      policy_verdict: policyVerdict,
      policy_reason: policyReason,
      impact_dollar_value: detected.impact.dollarValue ?? null,
      impact_apy_delta_bps: detected.impact.apyDeltaBps ?? null,
      impact_buffer_days: detected.impact.bufferDays ?? null,
      confidence: detected.confidence,
      venue_category: detected.venueCategory ?? null,
      data_freshness: detected.dataFreshness,
      supporting_data: detected.supportingData,
      dedup_key: detected.dedupKey,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create insight: ${error.message}`);
  }

  await writeAuditLog({
    userId,
    enterpriseId,
    action: 'insight_create',
    entityType: 'treasury_insight',
    entityId: data.id,
    details: {
      detector: detectorName,
      type: detected.type,
      severity: detected.severity,
      dedup_key: detected.dedupKey,
    },
  });

  return data as StoredInsight;
}

// ─── Read ─────────────────────────────────────────────────────────────

export interface ListInsightsQuery {
  enterpriseId: string;
  userId?: string;
  state?: InsightState | InsightState[];
  /** Max rows to return. Default 50. */
  limit?: number;
  /** Cursor (ISO timestamp) for pagination. Results created before this. */
  before?: string;
}

/**
 * List insights for a user/enterprise, newest first. Filters by state
 * and respects the cursor for pagination.
 */
export async function listInsights(
  query: ListInsightsQuery,
  supabase: SupabaseClient = createAdminClient(),
): Promise<StoredInsight[]> {
  let q = supabase
    .from('treasury_insights')
    .select('*')
    .eq('enterprise_id', query.enterpriseId)
    .order('created_at', { ascending: false })
    .limit(query.limit ?? 50);

  if (query.userId) {
    q = q.eq('user_id', query.userId);
  }

  if (query.state) {
    const states = Array.isArray(query.state) ? query.state : [query.state];
    q = q.in('state', states);
  } else {
    // Default: only active states
    q = q.in('state', ['new', 'viewed']);
  }

  if (query.before) {
    q = q.lt('created_at', query.before);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`Failed to list insights: ${error.message}`);
  }

  return (data ?? []) as StoredInsight[];
}

export async function getInsight(
  id: string,
  supabase: SupabaseClient = createAdminClient(),
): Promise<StoredInsight | null> {
  const { data, error } = await supabase
    .from('treasury_insights')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get insight: ${error.message}`);
  }

  return data as StoredInsight | null;
}

// ─── State transitions ───────────────────────────────────────────────

/**
 * Insight state machine. Exported so unit tests can validate the rules
 * without needing a Supabase test harness. The corresponding DB rows
 * enforce the same invariants via the `insight_state` enum + check
 * constraints in migration 0037.
 */
export const VALID_TRANSITIONS: Record<InsightState, InsightState[]> = {
  new: ['viewed', 'dismissed', 'acted_on', 'expired'],
  viewed: ['dismissed', 'acted_on', 'expired'],
  dismissed: [],
  acted_on: [],
  expired: [],
};

export function isValidTransition(from: InsightState, to: InsightState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Mark an insight as viewed. Idempotent — if already viewed, no-op.
 */
export async function markViewed(
  id: string,
  userId: string,
  supabase: SupabaseClient = createAdminClient(),
): Promise<void> {
  const insight = await getInsight(id, supabase);
  if (!insight) throw new Error(`Insight not found: ${id}`);

  if (insight.state !== 'new') return; // idempotent

  const { error } = await supabase
    .from('treasury_insights')
    .update({ state: 'viewed', viewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('state', 'new'); // race-safe: only transition if still new

  if (error) {
    throw new Error(`Failed to mark insight viewed: ${error.message}`);
  }

  await writeAuditLog({
    userId,
    enterpriseId: insight.enterprise_id,
    action: 'insight_view',
    entityType: 'treasury_insight',
    entityId: id,
  });
}

/**
 * Dismiss an insight. Sets a cooldown on the dedup_key to suppress
 * immediate re-creation by the next cron cycle. Writes audit log.
 */
export async function dismissInsight(
  id: string,
  userId: string,
  supabase: SupabaseClient = createAdminClient(),
): Promise<void> {
  const insight = await getInsight(id, supabase);
  if (!insight) throw new Error(`Insight not found: ${id}`);

  if (!isValidTransition(insight.state, 'dismissed')) {
    throw new Error(`Cannot dismiss insight in state ${insight.state}`);
  }

  const cooldownHours = DEFAULT_COOLDOWN_HOURS[insight.insight_type] ?? 24;
  const cooldownUntil = new Date(Date.now() + cooldownHours * 60 * 60 * 1000);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('treasury_insights')
    .update({
      state: 'dismissed',
      dismissed_at: now,
      cooldown_until: cooldownUntil.toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to dismiss insight: ${error.message}`);
  }

  await writeAuditLog({
    userId,
    enterpriseId: insight.enterprise_id,
    action: 'insight_dismiss',
    entityType: 'treasury_insight',
    entityId: id,
    details: { cooldown_hours: cooldownHours },
  });
}

/**
 * Mark an insight as acted on — the treasurer took the recommended action
 * (or an equivalent). Does NOT set a cooldown; if the same condition
 * persists, it's fine for a new insight to fire.
 */
export async function markActedOn(
  id: string,
  userId: string,
  supabase: SupabaseClient = createAdminClient(),
): Promise<void> {
  const insight = await getInsight(id, supabase);
  if (!insight) throw new Error(`Insight not found: ${id}`);

  if (!isValidTransition(insight.state, 'acted_on')) {
    throw new Error(`Cannot mark acted_on from state ${insight.state}`);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('treasury_insights')
    .update({ state: 'acted_on', acted_on_at: now })
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to mark insight acted_on: ${error.message}`);
  }

  await writeAuditLog({
    userId,
    enterpriseId: insight.enterprise_id,
    action: 'insight_acted_on',
    entityType: 'treasury_insight',
    entityId: id,
  });
}

/**
 * Expire insights past their expires_at timestamp. Called by the cron
 * orchestrator at the top of each cycle. Returns the number expired.
 */
export async function expireStaleInsights(
  supabase: SupabaseClient = createAdminClient(),
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('treasury_insights')
    .update({ state: 'expired' })
    .in('state', ['new', 'viewed'])
    .lt('expires_at', now)
    .select('id, enterprise_id, user_id');

  if (error) {
    throw new Error(`Failed to expire insights: ${error.message}`);
  }

  // Non-blocking audit writes for each expired insight. Intentionally
  // fire-and-forget — expiry is a background sweep, not user-facing.
  for (const row of data ?? []) {
    writeAuditLog({
      userId: row.user_id as string,
      enterpriseId: row.enterprise_id as string,
      action: 'insight_expire',
      entityType: 'treasury_insight',
      entityId: row.id as string,
    }).catch(() => {});
  }

  return (data ?? []).length;
}
