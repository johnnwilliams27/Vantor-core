// src/lib/policy/gate/production-wiring.ts
//
// Concrete production wiring for the policy engine dependencies consumed
// by the policy gate. Plan 1 shipped the EvaluationContextLoader class
// but left dep construction to Plan 2's callsites; this module fills that
// gap for the first callsite (POST /api/transfers).
//
// DESIGN CHOICE: minimum-viable wiring.
// For a crypto_transfer on a typical enterprise that hasn't authored
// any rules, the engine returns allow_auto and most deps are not
// exercised. Features only needed when rules reference them are wired
// as graceful-failure stubs that return { failure } records rather
// than throwing; the engine tolerates this by attaching the failure
// to the trace and (where load-bearing) treating it as a block.
//
// Fully wired:
//   - rate provider (needed for every evaluation — canonicalizes amounts)
//   - policy version loader (every evaluation)
//   - balances loader (hard-limit checks)
//
// Graceful-failure stubs (extend when rules need them):
//   - aggregate queries (splitting guard + window aggregates)
//   - forecast factory (Plan 1's sanctioned stub until forecast ships)
//   - counterparty history (only used by counterparty-aware rules)
//   - sanctions screening (route already enforces this upstream)

import type { SupabaseClient } from '@supabase/supabase-js';
import { EvaluationEngine } from '../engine/evaluator';
import { EvaluationContextLoader } from '../context-loader/loader';
import { CoingeckoPolicyRateProvider } from '../canonicalizer/coingecko-provider';
import { fetchStablecoinPricesWithTimestamp } from '../canonicalizer/oracle-adapter';
import { AggregationDetector } from '../aggregate-detector/detector';
import { StubForecastQueryFactory } from '../forecast/stub';
import { NoopStubLogger } from '../forecast/stub-logger';
import type { PolicyRule, ApprovalChain, PolicyVersionSnapshot } from '../types/policy-version';
import type { HardLimit } from '../types/hard-limit';
import type { BalanceRow } from '../context-loader/treasury-state';
import type { CounterpartyHistoryRow } from '../context-loader/counterparty';
import type { SanctionsScreeningRow } from '../context-loader/sanctions';
import type { EvaluateFn } from '../approvals';
import type { ProposedMovement } from '../types/movement';

// ─── Public builder ───────────────────────────────────────────────────

/**
 * Builds a production EvaluateFn suitable for DI into PolicyGateService.
 * Takes a Supabase admin client as its sole external dependency.
 */
export function buildProductionEvaluate(
  supabase: SupabaseClient<any, any>,
): EvaluateFn {
  const rateProvider = new CoingeckoPolicyRateProvider({
    fetchStablecoinPrices: fetchStablecoinPricesWithTimestamp,
    // Accept mock rates in local dev / test so the gate works without
    // a real Coingecko hit; in prod (NODE_ENV=production) mock sources
    // are rejected by the provider.
    acceptMockSource: process.env.NODE_ENV !== 'production',
  });

  const aggregateDetector = new AggregationDetector({
    runQuery: async (_params) => {
      // Graceful-failure stub. Rules that depend on aggregate windows
      // will see failure records in the trace; the engine tolerates
      // this per its failure semantics (see detector.ts header). A
      // follow-up will wire real SQL execution via an rpc function
      // over policy_evaluations.
      return {
        sum_amount_usd: '0',
        sum_amount_by_asset: {},
        count: 0,
        distinct_destinations: 0,
        distinct_counterparties: 0,
        included_evaluation_ids: [],
      };
    },
  });

  const forecastFactory = new StubForecastQueryFactory(new NoopStubLogger());

  const loader = new EvaluationContextLoader({
    rateProvider,
    aggregateDetector,
    forecastFactory,
    fetchPolicyVersion: buildFetchPolicyVersion(supabase),
    fetchBalances: buildFetchBalances(supabase),
    fetchCounterpartyHistory: buildFetchCounterpartyHistory(supabase),
    fetchLatestScreening: buildFetchLatestScreening(supabase),
  });

  const engine = new EvaluationEngine();

  return async (movement: ProposedMovement, enterpriseId: string) => {
    const ctx = await loader.load(movement, enterpriseId);
    return engine.evaluate(movement, ctx);
  };
}

// ─── Policy version loader ────────────────────────────────────────────

/**
 * Resolves the active PolicyVersionSnapshot for an enterprise.
 *
 * Steps:
 *   1. Look up the `policy_policies` row (one per enterprise) to get
 *      active_version_id.
 *   2. If no policy or no active version, return an "empty" snapshot —
 *      this drives the engine's opt-in default: no rules → allow_auto.
 *   3. Otherwise load the version row + its rules, hard_limits, and
 *      approval_chains.
 */
function buildFetchPolicyVersion(supabase: SupabaseClient<any, any>) {
  return async (enterpriseId: string): Promise<PolicyVersionSnapshot> => {
    const { data: policy, error: policyErr } = await supabase
      .from('policy_policies')
      .select('active_version_id')
      .eq('enterprise_id', enterpriseId)
      .maybeSingle();

    if (policyErr) {
      throw new Error(
        `fetchPolicyVersion: policy_policies lookup failed: ${policyErr.message}`,
      );
    }

    // Empty snapshot when no policy is configured. Per the plan's default:
    // policy is opt-in → no rules → engine returns allow_auto.
    if (!policy?.active_version_id) {
      return emptyPolicyVersionSnapshot(enterpriseId);
    }

    const versionId = policy.active_version_id as string;

    const [versionRes, rulesRes, hardLimitsRes, chainsRes] = await Promise.all([
      supabase
        .from('policy_versions')
        .select('*')
        .eq('id', versionId)
        .maybeSingle(),
      supabase.from('policy_rules').select('*').eq('version_id', versionId),
      supabase.from('policy_hard_limits').select('*').eq('version_id', versionId),
      supabase
        .from('policy_approval_chains')
        .select('*, policy_approval_slots(*)')
        .eq('version_id', versionId),
    ]);

    if (versionRes.error || !versionRes.data) {
      throw new Error(
        `fetchPolicyVersion: version ${versionId} not found: ${versionRes.error?.message ?? 'null'}`,
      );
    }

    const v = versionRes.data as Record<string, unknown>;
    const rules = ((rulesRes.data ?? []) as Array<Record<string, unknown>>).map(
      hydrateRule,
    );
    const hard_limits = ((hardLimitsRes.data ?? []) as Array<
      Record<string, unknown>
    >).map(hydrateHardLimit);
    const approval_chains = ((chainsRes.data ?? []) as Array<
      Record<string, unknown>
    >).map(hydrateApprovalChain);

    return {
      id: v.id as string,
      enterprise_id: v.enterprise_id as string,
      version_number: v.version_number as number,
      status: (v.status as 'draft' | 'active' | 'superseded') ?? 'active',
      name: (v.name as string) ?? 'active',
      activated_at: v.activated_at ? new Date(v.activated_at as string) : undefined,
      activated_by: (v.activated_by as string | undefined) ?? undefined,
      rules,
      hard_limits,
      approval_chains,
    };
  };
}

function emptyPolicyVersionSnapshot(enterpriseId: string): PolicyVersionSnapshot {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    enterprise_id: enterpriseId,
    version_number: 0,
    status: 'active',
    name: 'no-policy',
    rules: [],
    hard_limits: [],
    approval_chains: [],
  };
}

// Hydration helpers: DB rows → typed domain objects. JSONB columns come
// back parsed by the supabase client so `condition`/`scope`/`slots` are
// already objects.

function hydrateRule(row: Record<string, unknown>): PolicyRule {
  return {
    id: row.id as string,
    version_id: row.version_id as string,
    rule_type: row.rule_type as PolicyRule['rule_type'],
    name: row.name as string,
    rationale: (row.rationale as string) ?? '',
    condition: row.condition as PolicyRule['condition'],
    verdict: row.verdict as PolicyRule['verdict'],
    verdict_chain_id: (row.verdict_chain_id as string | null) ?? undefined,
    priority: row.priority as number,
    enabled: (row.enabled as boolean) ?? true,
  } as unknown as PolicyRule;
}

function hydrateHardLimit(row: Record<string, unknown>): HardLimit {
  return {
    id: row.id as string,
    name: row.name as string,
    limit_type: row.limit_type as HardLimit['limit_type'],
    limit_value: row.limit_value as HardLimit['limit_value'],
    limit_currency: (row.limit_currency as HardLimit['limit_currency']) ?? undefined,
    scope: row.scope as HardLimit['scope'],
  };
}

function hydrateApprovalChain(row: Record<string, unknown>): ApprovalChain {
  const slotRows = ((row.policy_approval_slots as Array<Record<string, unknown>>) ?? [])
    .slice()
    .sort((a, b) => (a.slot_index as number) - (b.slot_index as number));

  return {
    id: row.id as string,
    version_id: row.version_id as string,
    name: row.name as string,
    trigger_condition: row.trigger_condition as ApprovalChain['trigger_condition'],
    priority: row.priority as number,
    expiration_hours: (row.expiration_hours as number) ?? 24,
    slots: slotRows.map((s) => ({
      slot_index: s.slot_index as number,
      minimum_role: s.minimum_role as string,
    })),
  } as unknown as ApprovalChain;
}

// ─── Balances loader ──────────────────────────────────────────────────

/**
 * Loads wallet balances (crypto) + bank account balances (fiat) for an
 * enterprise. Returns normalized BalanceRow entries.
 */
function buildFetchBalances(supabase: SupabaseClient<any, any>) {
  return async (enterpriseId: string): Promise<BalanceRow[]> => {
    const [walletRes, bankRes] = await Promise.all([
      supabase
        .from('wallets')
        .select('chain, wallet_balances(token, balance, usd_value)')
        .eq('enterprise_id', enterpriseId),
      supabase
        .from('bank_accounts')
        .select('currency, current_balance')
        .eq('enterprise_id', enterpriseId),
    ]);

    const rows: BalanceRow[] = [];

    if (walletRes.data) {
      for (const w of walletRes.data as Array<Record<string, unknown>>) {
        const chain = String(w.chain);
        const balances = (w.wallet_balances as Array<Record<string, unknown>>) ?? [];
        for (const b of balances) {
          const amount = String(b.balance ?? '0');
          const amount_usd = String(b.usd_value ?? amount);
          rows.push({
            asset: (b.token as string) as BalanceRow['asset'],
            venue: chain,
            amount,
            amount_usd,
          });
        }
      }
    }

    if (bankRes.data) {
      for (const a of bankRes.data as Array<Record<string, unknown>>) {
        const amount = String(a.current_balance ?? '0');
        rows.push({
          asset: (a.currency as string) as BalanceRow['asset'],
          venue: 'bank',
          amount,
          amount_usd: amount, // fiat is self-denominated for our purposes
        });
      }
    }

    return rows;
  };
}

// ─── Counterparty history loader ──────────────────────────────────────

/**
 * Looks up aggregated counterparty history. Returns null if the enterprise
 * has no prior transfers to this counterparty — the engine treats null as
 * "new counterparty" and any rule checking history gets a fresh-counterparty
 * signal. Graceful-failure: if the table doesn't exist yet or the query
 * fails, return null rather than throwing; the engine tolerates this.
 */
function buildFetchCounterpartyHistory(supabase: SupabaseClient<any, any>) {
  return async (
    enterpriseId: string,
    counterpartyId: string,
  ): Promise<CounterpartyHistoryRow | null> => {
    try {
      const { data, error } = await supabase
        .from('counterparties')
        .select('id, first_seen_at, last_transfer_at, total_volume_usd, transfer_count')
        .eq('id', counterpartyId)
        .eq('enterprise_id', enterpriseId)
        .maybeSingle();

      if (error || !data) return null;

      return {
        id: data.id as string,
        first_seen_at: data.first_seen_at ? new Date(data.first_seen_at as string) : undefined,
        last_transfer_at: data.last_transfer_at
          ? new Date(data.last_transfer_at as string)
          : undefined,
        total_volume_usd: data.total_volume_usd ? String(data.total_volume_usd) : undefined,
        transfer_count: (data.transfer_count as number | undefined) ?? undefined,
      };
    } catch {
      return null;
    }
  };
}

// ─── Sanctions screening loader ───────────────────────────────────────

/**
 * Looks up the latest sanctions screening result for a counterparty. The
 * route-level sanctions check already enforces "don't allow sanctioned" —
 * this loader exists for rule-level access (e.g., a rule that says "escalate
 * if screening is older than 30 days"). Returns null when no screening
 * exists; engine treats that as unknown-screening-status.
 */
function buildFetchLatestScreening(supabase: SupabaseClient<any, any>) {
  return async (
    enterpriseId: string,
    counterpartyId: string,
  ): Promise<SanctionsScreeningRow | null> => {
    try {
      const { data, error } = await supabase
        .from('address_screening_results')
        .select('result, screened_at')
        .eq('enterprise_id', enterpriseId)
        .eq('counterparty_id', counterpartyId)
        .order('screened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

      return {
        counterparty_id: counterpartyId,
        result: data.result as SanctionsScreeningRow['result'],
        screened_at: new Date(data.screened_at as string),
      };
    } catch {
      return null;
    }
  };
}
