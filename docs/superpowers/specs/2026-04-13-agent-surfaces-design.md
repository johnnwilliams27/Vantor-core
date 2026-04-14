# Agent Surfaces Redesign — Design Spec

**Date:** 2026-04-13
**Branch:** `feature/agent-surfaces-design`
**Status:** Design — not yet approved
**Supersedes:** `project_insights_engine_v1.md` workstreams (parked) + portions of `docs/style-guide.html` §02 badges (purple "special" now load-bearing)

---

## 1 · Summary

Consolidate and redesign every surface where AI-generated content and compliance actions appear in Vantor — Dashboard, Treasury AI, `/approvals`, sidebar, emails — into a coherent system with:

- A **two-channel agent model** (deterministic detectors + advisory notes)
- A **47-detector registry** as the scaled replacement for today's 3 detectors + daily rules
- One canonical data model (`treasury_insights`) absorbing the retired `ai_recommendations` table
- A **purple agent signal** threaded consistently through every surface, powered by style-guide primitives
- An **AI logic manifest** — typed-TS source of truth rendered to JSON + markdown + an in-app Agent Policy surface for transparency

Non-goals of this spec:
- Risk scoring and external input signal integration (parked to Phase 4; see `project_insights_phase3_risk_signals.md`)
- Implementing all 47 detectors (Phase 2, scoped separately)
- Channel 2 cost-controls implementation (Phase 3, scoped separately)

This spec defines the architecture, visual system, data model, phasing, and executes Phase 0 in detail. Subsequent phases get their own implementation plans referencing this spec.

---

## 2 · Background & motivation

### 2.1 · Current fragmentation

The app has four overlapping surfaces for AI-generated or compliance content, each with its own data model, visual treatment, and semantics:

| Surface | Data source | Visual language | Where it lives |
|---|---|---|---|
| Dashboard "AI Insights" card | `ai_recommendations` + `scheduled_operations` unioned | BrainCircuit icon, status dots, inline review buttons | `/dashboard` |
| Treasury AI → Insights Feed | `treasury_insights` | Lightbulb icon, `border-l-4` severity accent, impact metric grid | `/treasury` Overview |
| Treasury AI → Actions Overview | `ai_recommendations` | Sparkles icon, status dot, no severity border | `/treasury` Overview |
| `/approvals` page | `policy_approval_requests` | Table with filter bar + detail dialog, no AI styling | `/approvals` |

Gaps this creates:
1. **Two parallel AI streams** (Insights + Actions Overview) render side-by-side on Treasury AI with asymmetric visual language
2. **"AI Insights" label** on Dashboard is inaccurate — shows AI recs mixed with user-initiated scheduled operations
3. **No visual signature** that consistently signals "agent-generated." Each surface improvised its own (BrainCircuit / Lightbulb / Sparkles)
4. **No surface for Channel 2 advisory narratives** — we want to ship them but have nowhere coherent to put them
5. **No transparency surface** — users and regulators cannot inspect how the agent is configured
6. **47 detectors ship into this mess** and make it worse if not addressed first

### 2.2 · What's already shipped (preserves)

- `/approvals` page with `ApprovalDetailDialog`, role-gated actions (Apr 13, PR #16)
- Policy gate extended to yield/ramps/scheduled-ops/swaps/bridges (PR #14, #18)
- Policy evaluation persistence (PR #21) — one row per gate evaluate
- Executor registry dispatching approved movements (PR #16)
- RBAC hierarchy with executive role + strict enterprise_admin SoD (PR #9)
- Style Guide (Satoshi, purple-as-AI, `rounded-lg` cards, 8-color semantic palette, elevation/motion scales)

This redesign composes on these — it does not unwind them.

### 2.3 · AI-forward positioning

Vantor positions as AI-native. Users should perceive the product as having an actor (the Agent) working on their behalf continuously. Today the UI doesn't express this — it just shows rows. The redesign frames all AI output as authored by "the Agent," using purple (already the "AI / special / tier" semantic in the palette) as the consistent signal.

---

## 3 · Goals

1. **One canonical data model** for all AI-generated content
2. **One visual signature** ("purple = agent-authored") across every surface
3. **Clear intent separation:** Agent output (consume) vs. user queue (act) vs. compliance approvals (cross-user sign-off)
4. **Channel 2 has a home** — advisory narrative "Notes" render somewhere coherent
5. **Every agent behavior is transparent** via an Agent Policy surface backed by a typed manifest
6. **Style-guide compliance** — compose from existing primitives, extend sparingly with documented additions
7. **Zero regression in existing approval flows** during alignment — feature-flag any risky cutover
8. **Architectural invariants remain enforced** — AI never auto-executes money movement; Channel 2 cannot block/gate/approve

---

## 4 · Terminology lock

Binding across code, copy, and docs. Copy audit in Phase 0A enforces this.

| Term | Meaning | Where used |
|---|---|---|
| **Agent** | The Vantor AI. Singular actor. Capitalized as a proper noun in copy. | Everywhere user-facing |
| **Insight** | Deterministic detector output. May carry a `recommended_action`. Lives in `treasury_insights` with `channel='deterministic'`. | Treasury AI, Dashboard |
| **Note** | Advisory AI narrative (Channel 2). Never actionable, never gates movement. `channel='advisory'`. | Treasury AI |
| **Filing** | Editorial verb for agent-authored content reaching the user. "Filed 3m ago." | Timestamps, section labels |
| **Approval** | Cross-user policy-gated sign-off. `policy_approval_requests` row. | `/approvals` |
| **Authorization** | Initiator confirming their own action (MFA, quote review). `scheduled_operations.awaiting_authorization`. | Dashboard, ApprovalModal |
| **Recommendation** | Retired as a UI noun. Only survives as the `recommended_action` field on an Insight. | DB field only |
| **Agent Policy** | The manifest describing how the Agent is configured. | Treasury AI tab, `/api/ai-logic/manifest` |

---

## 5 · Two-channel agent architecture

```
┌──────────────────────── Channel 1: Deterministic ────────────────────────┐
│                                                                          │
│   47 registered detectors (+ daily rules as #48)                         │
│   Runs: every 15min cron + inline triggers (deposit/withdraw/confirm)    │
│   Output: treasury_insights rows, channel='deterministic'                │
│   Can carry: recommended_action, policy_verdict                          │
│   Claude reasoning: ONLY on critical/warning severity                    │
│   Can gate movement: YES (via recommended_action → policy-gate)          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────── Channel 2: Advisory ─────────────────────────────┐
│                                                                          │
│   Single Claude pass with full DetectorContext → narrative observations  │
│   Invocation (Approach E):                                               │
│     - Daily batch via Anthropic Batches API (50% cheaper, 24h OK)        │
│     - On-state-change triggers (new critical insight, large movement)    │
│     - On-demand (user-initiated "Analyze now" button)                    │
│   Gate: material-state hash + 7-day forced floor                         │
│   Output: treasury_insights rows, channel='advisory'                     │
│   CANNOT carry: recommended_action, policy_verdict (CHECK constraint)    │
│   Can gate movement: NO — advisory only, never actionable                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 5.1 · Invariants (codified in `ai-guardrails.ts`)

These live at the top of the manifest source, are rendered verbatim to the Agent Policy surface, and are visible to any auditor hitting `/api/ai-logic/manifest`:

```ts
export const AI_INVARIANTS = [
  {
    id: 'no-auto-exec',
    statement: 'AI-generated insights never trigger money movement without human approval.',
    enforced_by: 'All recommended_action values route through policy-gate → approval workflow.',
  },
  {
    id: 'no-rule-authoring',
    statement: 'The Agent cannot author or edit policy rules.',
    enforced_by: 'Rules authored only via /api/policy/rules/* (RBAC-gated).',
  },
  {
    id: 'no-channel1-rescoring',
    statement: 'AI narrative cannot change severity, verdict, or order of deterministic insights.',
    enforced_by: 'Channel 2 writes separate rows; never mutates Channel 1 rows.',
  },
  {
    id: 'channel2-advisory-only',
    statement: 'Notes are narrative-only and never block, gate, or approve transactions.',
    enforced_by: 'CHECK constraint: channel=advisory → recommended_action IS NULL AND policy_verdict IS NULL.',
  },
  {
    id: 'budget-capped',
    statement: 'Agent spend per enterprise is hard-capped. Exceeding the cap disables Channel 2 until next cycle.',
    enforced_by: 'invocation-policy.ts + spend tracking; Channel 1 reasoning is not capped separately.',
  },
] as const
```

---

## 6 · Data model

### 6.1 · `treasury_insights` changes

Migration `0054_insights_channel.sql` (next free after 0053):

```sql
-- Add channel column
ALTER TABLE treasury_insights
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'deterministic'
    CHECK (channel IN ('deterministic', 'advisory'));

-- CHECK constraint: advisory rows can't carry actionable fields
ALTER TABLE treasury_insights
  ADD CONSTRAINT treasury_insights_channel_fields_check
    CHECK (
      channel = 'deterministic'
      OR (recommended_action IS NULL AND policy_verdict IS NULL)
    );

-- Index for channel-filtered queries
CREATE INDEX treasury_insights_channel_idx
  ON treasury_insights(enterprise_id, channel, created_at DESC);

-- Add detector_name value for daily rules migration (Phase 0A)
-- no schema change, just documenting: 'daily_rules_engine' will be used
```

### 6.2 · `ai_recommendations` retirement

- Phase 0A migrates all `ai_recommendations` rows → `treasury_insights` with `detector_name='daily_rules_engine'`, `recommended_action` populated from the old row
- Retention window on `ai_recommendations` is short (<90d per memory), so a one-shot cutover is safe — no dual-write period
- Drop table in Phase 1 after soak
- `approved_by/at`, `rejected_by/at` fields map to `policy_approval_requests` where applicable; otherwise preserved in `supporting_data` JSONB for audit

### 6.3 · Other tables — no schema changes in Phase 0

- `scheduled_operations` — unchanged; dual-status path (`awaiting_authorization` vs `awaiting_approval`) is correct and documented in manifest
- `policy_approval_requests` — unchanged; Phase 0A adds `Badge variant="special"` provenance on rows where `proposed_movement.metadata.initiator.type === 'ai'`
- `customer_insight_settings` — unchanged (PR #5's per-enterprise config)

---

## 7 · UI surface inventory

### 7.1 · Where Insights live

**Primary home: Treasury AI → Overview tab** (`/treasury`)

Full two-column feed:
- **Left (60%): Agent Insights** — all `channel='deterministic'` rows, severity-sorted, filterable by severity/detector/state
- **Right (40%): Notes** — all `channel='advisory'` rows, long-form purple QuotePanel treatment

**Summary: Dashboard** (`/dashboard`)
- Agent Insights card with top 3 rows, link to Treasury AI for full view
- Does NOT surface Notes (too long-form for dashboard density)

### 7.2 · Where Approvals live

Unchanged — `/approvals` page with existing `ApprovalDetailDialog`. Add:
- `Badge variant="special" size="xs">Agent</Badge>` on rows where `initiator.type === 'ai'`
- Sidebar count badge showing pending approvals the current user can act on

### 7.3 · Where Authorizations live

Unchanged — Dashboard "Your Queue" card with existing `ApprovalModal` for scheduled operations awaiting authorization.

### 7.4 · New surface: Agent Policy

**Location:** Treasury AI → new tab "Agent Policy"

Renders the manifest:
- **Invariants** — the 5 hard rules, verbatim from `AI_INVARIANTS`
- **Detector registry** — all 47 detectors with status (active / deferred / proposed), channel, severity range, current thresholds (per-enterprise if customized)
- **Cost controls** — per-enterprise monthly budget, current spend, cadence rules (daily + state-change + on-demand)
- **Data sources** — placeholder for Phase 4 (risk inputs)
- **Version + git SHA** at the top

Also exposed at `/api/ai-logic/manifest` (JSON) and `docs/AI_LOGIC.md` (generated).

### 7.5 · Not a surface

To prevent creep:
- No insights popover in Topbar
- No dedicated `/insights` page (Treasury AI IS the inbox)
- No email notifications change in this spec (existing critical-severity email path preserved; Phase 3 may revisit)

---

## 8 · Visual system

### 8.1 · The Agent signal — purple

Style guide already assigns `purple = AI / special / tier`. This spec commits: **every surface displaying agent-authored content carries the purple signal**, consistently.

The signal has three elements, composable from existing primitives:

1. **`<Badge variant="special" dot>Agent</Badge>`** — appears in headers, in `/approvals` rows with AI-initiated movements, and at the top of the Notes section
2. **`<IconTile variant="special">`** — purple icon container on Card headers for agent surfaces
3. **Purple tint on narrative surfaces** — extends `<QuotePanel tone="special">` (new `tone` variant added in Phase 0)

Agent signal is NOT applied to:
- User authorization queue items
- Policy approval requests authored by users (only by AI)
- Settings, account, billing, non-agent surfaces

### 8.2 · Severity (orthogonal to agent signal)

Severity uses the existing semantic palette and does NOT overlap with purple:
- **`border-l-4 border-red-500/60`** + `<StatusDot variant="failed">` → critical
- **`border-l-4 border-amber-500/60`** + `<StatusDot variant="pending">` → warning
- **`border-l-4 border-teal-500/60`** + `<StatusDot variant="active">` → info

These are layered with the agent signal — a card can be both "agent-authored" (purple Badge) and "critical severity" (red left border). They represent different semantic axes.

### 8.3 · Primitive composition

#### Agent Insight card

```tsx
<Card variant="default">
  <CardHeader
    icon={<IconTile variant="special" icon={<DetectorIcon />} size="sm" />}
    title="Concentration breach"
    subtitle={<FreshnessBadge>Filed 9:42</FreshnessBadge>}
    trailing={
      <div className="flex items-center gap-2">
        <Badge variant="special" size="xs" dot>Agent</Badge>
        <StatusDot variant="failed" label="Critical" />
      </div>
    }
  />
  <div className="border-l-4 border-red-500/60 pl-4 space-y-3">
    <p className="text-sm text-muted-foreground">
      USDC holdings on Base exceed 80% cap
    </p>
    <div className="grid grid-cols-2 gap-3 font-mono tabular-nums text-sm">
      <div>
        <div className="text-xs text-muted-foreground">Exposure</div>
        <div>$4,200,000</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Over cap</div>
        <div className="text-red-400">+12bps</div>
      </div>
    </div>
  </div>
  <CardActions>
    <Button variant="ghost" size="sm">Dismiss</Button>
    <Button variant="default" size="sm">Review</Button>
  </CardActions>
</Card>
```

#### Note block (Channel 2)

```tsx
<QuotePanel tone="special">
  <div className="text-xs uppercase tracking-wide text-purple-400 font-medium">
    Note
  </div>
  <h3 className="font-bold text-lg mt-1">On yield positioning</h3>
  <div className="max-w-[65ch] text-sm leading-relaxed mt-3 space-y-3">
    <p>
      Your satellite allocation has drifted from the target conservative
      posture over the past three weeks. DeFi exposure is now 34% of yield
      holdings against the 25% target you set in Q1.
    </p>
    <p>
      Three factors contributed: yield compression in MMF tier-1 venues,
      two successful rebalances into Morpho vaults, and no corresponding
      increase in MMF allocation.
    </p>
  </div>
  <div className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
    <Badge variant="special" size="xs" dot>Agent</Badge>
    <span>· Filed 04:12</span>
  </div>
</QuotePanel>
```

The two shapes are **structurally distinct** (compact Card vs wide Panel, metric grid vs prose paragraph) so users learn the affordance. Both carry purple. Severity only appears on Insights (Notes are never severity-coded — that would imply actionability).

### 8.4 · Primitive extensions needed

**New:**
- `<QuotePanel tone="default" | "special">` — add `tone` prop; `special` variant applies purple tint (`bg-purple-500/5 border-purple-500/20`) and purple text accents

**Nothing else new.** Everything else composes from shipped primitives: Card, CardHeader, CardActions, Badge, IconTile, StatusDot, FreshnessBadge, Button, EmptyStateCard, TableCard.

### 8.5 · Motion

Fits the style-guide scale (100 / 150 / 200 / 300ms, `cubic-bezier(0.16, 1, 0.3, 1)` natural):

- **New insight appearance** — 200ms fade-up, 50ms stagger between cards in the same batch
- **Card hover** — existing primitive behavior (no change)
- **Section reveal on tab switch** — existing Tabs primitive behavior
- **Reduced motion** — all translate animations fall back to opacity fade (style-guide compliant)

No breathing pulses, no typewriter effects, no decorative motion added.

### 8.6 · Typography

Already Satoshi + SF Mono globally with `tnum`/`lnum` on. This spec does NOT add fonts. Agent surfaces use:
- `font-bold` (700) for Card titles and section headers
- `font-medium` (500) for "Note" / "Agent" eyebrow labels
- `font-normal` (400) for body prose
- `font-mono tabular-nums` for all dollar values, bps, timestamps

---

## 9 · AI logic manifest

### 9.1 · Source structure

```
src/lib/insights/policy/
├── detector-registry.ts    // All 47 detectors + metadata
├── cost-controls.ts        // Budget caps, cache config, severity gates
├── invocation-policy.ts    // Approach E cadence, hash-gate, weekly floor
├── ai-guardrails.ts        // AI_INVARIANTS
├── custom-observations.ts  // Per-enterprise overrides (hooks into customer_insight_settings)
└── manifest.ts             // Aggregator; exports AILogicManifest + version + git SHA
```

### 9.2 · Detector registry shape

```ts
export interface DetectorSpec {
  id: string                          // 'concentration-breach'
  name: string                        // 'Concentration breach'
  channel: 'deterministic'
  category: 'concentration' | 'liquidity' | 'yield' | 'compliance' | 'ops' | 'market' | 'behavioral'
  severity_range: Array<'info' | 'warning' | 'critical'>
  status: 'active' | 'deferred' | 'proposed'
  description: string
  thresholds: Record<string, number | string>
  inputs: string[]                    // ['holdings', 'policy.concentration_caps']
  emits_recommended_action: boolean
  added_in: string                    // '2026-04-13'
  version: number                     // bumps when thresholds/logic change
}

export const DETECTOR_REGISTRY: readonly DetectorSpec[] = [ /* 47 entries */ ]
```

Phase 1 registers all 47 with `status` reflecting actual implementation state. Phase 2 flips to `active` as each detector is built and tested.

### 9.3 · Rendered surfaces

Same data, three outputs:

1. **Code** — TypeScript consumers (detectors + runners import typed registry)
2. **JSON endpoint** — `GET /api/ai-logic/manifest` returns `{ version, git_sha, generated_at, invariants, detectors, cost_controls, invocation_policy }`. RBAC: anyone in the enterprise can read. Used by auditors / external integrations.
3. **Markdown doc** — `docs/AI_LOGIC.md` generated by `npm run gen:ai-logic` (CI job). Committed — git log is the change history.
4. **Agent Policy UI** — renders the manifest in readable form per-enterprise (with that enterprise's custom overrides applied).

### 9.4 · Versioning

- `manifest.version` is a semver string, bumps on any behavior-affecting change
- Response includes `version` + `git_sha` + `generated_at`
- Customers can pin to a version for compliance (`/api/ai-logic/manifest?version=1.4.0`) — Phase 1 ships v1.0.0

---

## 10 · Phase ordering

| Phase | Scope | Size | Dependencies |
|---|---|---|---|
| **0 · Surface foundation** | Primitive extensions (QuotePanel tone), channel column migration, shared AgentSignature helper | Small, 1 PR | None |
| **0A · Alignment migration** | ai_recommendations → treasury_insights cutover, Dashboard card split, sidebar badge, approval provenance | Medium, 1 PR | Phase 0 |
| **1 · Manifest + registry** | Full 47-detector spec (mostly `status:deferred`), Agent Policy tab, JSON endpoint, generated markdown | Medium, 1 PR | Phase 0A |
| **2 · Detector implementations** | Build out 47 detectors across 3-5 PRs grouped by category | Large, 3-5 PRs | Phase 1 |
| **3 · Channel 2 Notes** | Approach E invocation, Batches API, hash-gate, Notes section, budget UI | Medium, 1 PR | Phase 2 (at least half the detectors active) |
| **4 · Risk + input signals** | Deferred — see `project_insights_phase3_risk_signals.md` | — | Phase 3 complete |

Each phase gets its own implementation plan (`writing-plans` skill output) referencing this design as the source of truth.

---

## 11 · Phase 0 detail (immediate execution)

### 11.1 · Scope

Single PR on branch `feature/agent-surfaces-foundation`. Small, low-risk, zero user-visible change (primitives only + DB migration with backfill).

### 11.2 · Deliverables

1. **Extend `<QuotePanel>`** in `src/components/ui/quote-panel.tsx`:
   - Add `tone?: 'default' | 'special'` prop (default: `'default'`)
   - `'special'` variant: `bg-purple-500/5 border-purple-500/20`, eyebrow text uses `text-purple-400`
   - Update existing callers (grep `<QuotePanel`) — they continue to work unchanged (default tone)
   - Add Storybook/style-guide HTML example if that pattern is used in repo

2. **Add `<AgentSignature>` composition helper** in `src/components/agent/agent-signature.tsx`:
   ```tsx
   export function AgentSignature({ subtle = false }: { subtle?: boolean }) {
     return <Badge variant="special" size={subtle ? 'xs' : 'sm'} dot>Agent</Badge>
   }
   ```
   Single source of "how to render the Agent Badge." Every consumer uses this. If copy or shape changes in future, one place to edit.

3. **Migration `0054_insights_channel.sql`**:
   - Add `channel` column with CHECK and default `'deterministic'`
   - Add compound CHECK: advisory rows can't carry actionable fields
   - Add index on `(enterprise_id, channel, created_at DESC)`
   - Apply to dev + prod via `npx tsx scripts/migrate.ts`
   - Backfill: existing rows default to `'deterministic'` (no explicit backfill needed)

4. **Type update** in `src/types/database.ts` (or equivalent) to add `channel` field

5. **Update existing detector code** in `src/lib/insights/detectors/*` + `src/lib/insights/store.ts`:
   - `DetectedInsight` type gets `channel: 'deterministic'` set explicitly on all outputs
   - Store write path sets `channel` column

### 11.3 · Acceptance criteria

- [ ] `npm run tsc` passes
- [ ] `npm run test` passes with existing test suite
- [ ] Existing `<QuotePanel>` usages render identically (default tone preserved)
- [ ] `<QuotePanel tone="special">` renders with purple tint in a style-guide demo
- [ ] `<AgentSignature>` renders a purple "Agent" badge
- [ ] Migration 0054 applies cleanly on dev
- [ ] Migration 0054 applies cleanly on prod
- [ ] Inserting a row with `channel='advisory'` + non-null `recommended_action` fails the CHECK constraint
- [ ] All existing `treasury_insights` rows have `channel='deterministic'` after migration
- [ ] No user-visible change on Dashboard or Treasury AI

### 11.4 · Rollback

- Migration is additive; rollback drops `channel`, indexes, and constraints
- Primitive extensions are backward-compatible; rollback reverts the files
- `<AgentSignature>` not yet used; rollback removes the file

### 11.5 · Out of scope for Phase 0

- Any visible surface change — deferred to Phase 0A
- `ai_recommendations` migration — Phase 0A
- Agent Policy tab — Phase 1
- 47 detectors — Phase 2

---

## 12 · Open decisions deferred

Recording here so they resurface in their right phase:

1. **`<QuotePanel tone="special">` background opacity** — `/5` vs `/8` vs `/10`. Pick during visual QA. Default proposal: `/5` (matches `bg-purple-500/8` badge convention but one step softer for a larger surface).

2. **Agent Policy tab iconography** — which Lucide icon represents "policy" best? Candidates: `FileText`, `BookOpen`, `ShieldCheck`, `Scale`. Deferred to Phase 1.

3. **Channel 2 model selection** — Haiku 4.5 vs Sonnet 4.6. Cost math in earlier brainstorm assumed Sonnet; Haiku is cheaper but may narrate thinner. Defer to Phase 3 pilot — measure output quality before committing.

4. **Per-enterprise manifest override UX** — admins can tune thresholds via `customer_insight_settings`. Should this be editable from the Agent Policy tab directly, or remain settings-page-only? Defer to Phase 1 after building the read-only rendering.

5. **Retention policy on Notes** — 90-day TTL with soft-delete vs forever with collapse UI. Defer to Phase 3.

6. **Channel 2 email/notification path** — does a new critical Note email the user, or in-app only? Default: in-app only (prevent noise). Defer confirmation to Phase 3.

---

## 13 · Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `ai_recommendations` migration loses audit fields | Medium | High (regulatory) | Phase 0A preserves `approved_by/at`, `rejected_by/at` in `supporting_data` JSONB; run reconcile script comparing row counts pre/post |
| Purple signal too subtle, users don't learn it | Low | Medium | Combine purple Badge + IconTile + color-tinted Panel — three reinforcing signals, not one |
| Phase 1 manifest rendering exposes thresholds customers can reverse-engineer | Low | Low | Thresholds are already observable from insight output; making them explicit is a transparency win, not a leak |
| Channel 2 cost blowout | Medium | Medium | Hard budget cap per enterprise at the invocation-policy layer; 80% warning; hash-gate reduces calls on dormant customers |
| CHECK constraint on `channel+recommended_action` breaks a future detector that wants advisory + action | Low | Low | That would violate the core invariant; if the product direction shifts, revisit invariant AND schema together |
| Duplicate Insights if cutover races with ongoing cron run | Medium | Low | Phase 0A migration runs in a transaction; cron disabled during migration window (5-minute maintenance note) |

---

## 14 · References

- `docs/style-guide.html` — visual system
- `docs/superpowers/specs/2026-04-12-style-guide.md` — style guide implementation spec
- `src/lib/insights/` — existing detector engine (v1)
- `src/lib/policy/` — policy engine + gate + executor
- `project_insights_engine_v1.md` — v1 shipped state (supersedes noted above)
- `project_insights_phase3_risk_signals.md` — parked Phase 4 scope
- `project_ai_recommendations_always_require_approval.md` — `no-auto-exec` invariant origin

---

## 15 · Sign-off

Required before Phase 0 implementation plan:

- [ ] User approves terminology lock (§4)
- [ ] User approves purple-as-Agent-signal (§8.1)
- [ ] User approves phase ordering (§10)
- [ ] User approves Phase 0 scope (§11)

After sign-off, next step is `superpowers:writing-plans` skill invocation to produce `docs/superpowers/plans/2026-04-13-agent-surfaces-foundation-plan.md` — the Phase 0 implementation plan.
