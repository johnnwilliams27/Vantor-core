# Agent Surfaces Foundation (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the zero-user-visible foundation for the Agent Surfaces redesign — a new `<NotePanel>` primitive, an `<AgentSignature>` composition helper, and migration `0054_insights_channel.sql` adding the `channel` column + CHECK constraint to `treasury_insights`. Every existing detector emits `channel='deterministic'` after this plan lands.

**Architecture:** Follow the design in `docs/superpowers/specs/2026-04-13-agent-surfaces-design.md` §11. One deviation from §8.3 of the spec: the existing `<QuotePanel>` has a structured rows/youReceive API for financial quotes, not a children-based API. Rather than fork its contract, Phase 0 introduces a new `<NotePanel>` primitive for editorial prose surfaces. Both primitives coexist — QuotePanel for structured money data, NotePanel for narrative.

**Tech Stack:** Next.js 14 App Router, Tailwind CSS with the Vantor token system, Satoshi font globally, Vitest for unit tests, Supabase (`npx tsx scripts/migrate.ts` for migrations), TypeScript strict mode.

**Worktree:** `.worktrees/agent-surfaces-foundation` on branch `feature/agent-surfaces-foundation`. The design doc lives on `feature/agent-surfaces-design` — rebase or copy the spec file if needed.

---

## File Structure

**Create:**
- `src/components/ui/note-panel.tsx` — new purple-tinted editorial prose panel primitive
- `src/components/ui/note-panel.test.tsx` — unit tests
- `src/components/agent/agent-signature.tsx` — composition helper returning the Agent Badge
- `src/components/agent/agent-signature.test.tsx` — unit tests
- `supabase/migrations/0054_insights_channel.sql` — DB migration

**Modify:**
- `src/lib/insights/types.ts` — add `InsightChannel` type and `channel` field on `DetectedInsight` + `TreasuryInsightRow`
- `src/lib/insights/store.ts` — thread `channel` through `persist` insert
- `src/lib/insights/detectors/concentration.ts` — emit `channel: 'deterministic'`
- `src/lib/insights/detectors/liquidity.ts` — same
- `src/lib/insights/detectors/yield-rebalance.ts` — same
- `src/lib/insights/store.test.ts` — add channel-threading assertion
- `src/types/database.ts` — add `channel` to `treasury_insights` Row type if hand-maintained (otherwise regenerate from Supabase)

---

## Task 1: `<NotePanel>` primitive (TDD)

**Files:**
- Create: `src/components/ui/note-panel.tsx`
- Test: `src/components/ui/note-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/note-panel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotePanel } from './note-panel';

describe('NotePanel', () => {
  it('renders the eyebrow, heading, and children', () => {
    render(
      <NotePanel eyebrow="Note" heading="On yield positioning">
        <p>Your satellite allocation has drifted.</p>
      </NotePanel>,
    );
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('On yield positioning')).toBeInTheDocument();
    expect(screen.getByText('Your satellite allocation has drifted.')).toBeInTheDocument();
  });

  it('applies purple tone classes', () => {
    const { container } = render(
      <NotePanel eyebrow="Note" heading="x">
        <p>body</p>
      </NotePanel>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toMatch(/border-purple-500\/20/);
    expect(root.className).toMatch(/bg-purple-500\/5/);
  });

  it('renders optional signature line when provided', () => {
    render(
      <NotePanel eyebrow="Note" heading="x" signature="Filed 04:12">
        <p>body</p>
      </NotePanel>,
    );
    expect(screen.getByText(/Filed 04:12/)).toBeInTheDocument();
  });

  it('omits signature block when not provided', () => {
    render(
      <NotePanel eyebrow="Note" heading="x">
        <p>body</p>
      </NotePanel>,
    );
    expect(screen.queryByTestId('note-panel-signature')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/note-panel.test.tsx`
Expected: FAIL with "Cannot find module './note-panel'" (or equivalent module-not-found error)

- [ ] **Step 3: Write minimal implementation**

Create `src/components/ui/note-panel.tsx`:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Note panel — purple-tinted editorial prose surface for Channel 2
 * advisory notes. Children-based; use for narrative Agent-authored
 * observations. For structured financial quotes see `QuotePanel`.
 *
 * Part of the Agent Surfaces system (see
 * docs/superpowers/specs/2026-04-13-agent-surfaces-design.md §8).
 */
interface NotePanelProps {
  /** Small uppercase label above the heading (e.g. "Note"). */
  eyebrow: React.ReactNode;
  /** Primary title of the note. */
  heading: React.ReactNode;
  /** Prose content. Caller controls paragraph structure. */
  children: React.ReactNode;
  /** Optional filing signature line (e.g. "Filed 04:12"). */
  signature?: React.ReactNode;
  className?: string;
}

export function NotePanel({
  eyebrow,
  heading,
  children,
  signature,
  className,
}: NotePanelProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-purple-500/20 bg-purple-500/5 p-5',
        className,
      )}
    >
      <div className="text-xs uppercase tracking-wide text-purple-400 font-medium">
        {eyebrow}
      </div>
      <h3 className="mt-1 text-lg font-bold text-foreground">{heading}</h3>
      <div className="mt-3 max-w-[65ch] text-sm leading-relaxed text-foreground/90 space-y-3">
        {children}
      </div>
      {signature !== undefined && (
        <div
          data-testid="note-panel-signature"
          className="mt-4 text-xs text-muted-foreground"
        >
          {signature}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/note-panel.test.tsx`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/note-panel.tsx src/components/ui/note-panel.test.tsx
git commit -m "feat(ui): add NotePanel primitive for Agent advisory notes"
```

---

## Task 2: `<AgentSignature>` composition helper (TDD)

**Files:**
- Create: `src/components/agent/agent-signature.tsx`
- Test: `src/components/agent/agent-signature.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/agent/agent-signature.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentSignature } from './agent-signature';

describe('AgentSignature', () => {
  it('renders the Agent label', () => {
    render(<AgentSignature />);
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('uses the special (purple) Badge variant', () => {
    const { container } = render(<AgentSignature />);
    const badge = container.querySelector('[class*="purple"]');
    expect(badge).not.toBeNull();
  });

  it('renders a smaller variant when subtle is true', () => {
    const { rerender, container } = render(<AgentSignature />);
    const defaultBadge = container.firstChild as HTMLElement;
    const defaultClass = defaultBadge.className;

    rerender(<AgentSignature subtle />);
    const subtleBadge = container.firstChild as HTMLElement;
    expect(subtleBadge.className).not.toBe(defaultClass);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/agent/agent-signature.test.tsx`
Expected: FAIL with "Cannot find module './agent-signature'".

- [ ] **Step 3: Write minimal implementation**

Create `src/components/agent/agent-signature.tsx`:

```tsx
import * as React from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * Agent signature — the canonical "this is agent-authored" visual mark.
 * Renders the purple Badge (variant="special") used across the Agent
 * Surfaces system. Single source of truth for Agent labelling; callers
 * should use this instead of inlining <Badge variant="special">Agent</Badge>.
 *
 * See docs/superpowers/specs/2026-04-13-agent-surfaces-design.md §8.1.
 */
interface AgentSignatureProps {
  /** When true, uses xs size for inline contexts (e.g. table rows). */
  subtle?: boolean;
}

export function AgentSignature({ subtle = false }: AgentSignatureProps) {
  return (
    <Badge variant="special" size={subtle ? 'xs' : 'sm'} dot>
      Agent
    </Badge>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/agent/agent-signature.test.tsx`
Expected: PASS, all 3 tests green.

Note: if `Badge` doesn't yet support `size="xs"` or `dot`, confirm against `src/components/ui/badge.tsx`. The style-guide Stage 2 PR (`f282a06`) added these. If missing, fall back to `size="sm"` for both variants and remove the `subtle` branch.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent/agent-signature.tsx src/components/agent/agent-signature.test.tsx
git commit -m "feat(agent): add AgentSignature composition helper"
```

---

## Task 3: Write migration `0054_insights_channel.sql`

**Files:**
- Create: `supabase/migrations/0054_insights_channel.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/0054_insights_channel.sql`:

```sql
-- Migration 0054: Add channel column to treasury_insights
--
-- Phase 0 of the Agent Surfaces redesign. See
-- docs/superpowers/specs/2026-04-13-agent-surfaces-design.md §6.1.
--
-- channel='deterministic' — existing 47-detector output (default)
-- channel='advisory'      — Channel 2 narrative notes
--
-- CHECK: advisory rows cannot carry actionable fields. Enforces the
-- `channel2-advisory-only` invariant at the storage layer.

BEGIN;

ALTER TABLE treasury_insights
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'deterministic';

ALTER TABLE treasury_insights
  ADD CONSTRAINT treasury_insights_channel_values_check
  CHECK (channel IN ('deterministic', 'advisory'));

ALTER TABLE treasury_insights
  ADD CONSTRAINT treasury_insights_channel_fields_check
  CHECK (
    channel = 'deterministic'
    OR (recommended_action IS NULL AND policy_verdict IS NULL)
  );

CREATE INDEX treasury_insights_channel_idx
  ON treasury_insights(enterprise_id, channel, created_at DESC);

COMMIT;
```

- [ ] **Step 2: Lint the SQL locally**

Run: `cat supabase/migrations/0054_insights_channel.sql`

Verify:
- Single `BEGIN;` / `COMMIT;` pair wrapping the whole migration
- No syntax errors (eyeball: every statement ends with `;`, no typos)
- `DEFAULT 'deterministic'` spelled correctly
- CHECK constraint uses `OR (recommended_action IS NULL AND policy_verdict IS NULL)` (not `AND`)

- [ ] **Step 3: Commit the migration file (before applying)**

```bash
git add supabase/migrations/0054_insights_channel.sql
git commit -m "feat(db): migration 0054 — add channel column to treasury_insights"
```

---

## Task 4: Apply migration to dev Supabase

**Files:**
- None (operation on live dev DB)

- [ ] **Step 1: Verify env is pointing at dev**

Run: `grep -E 'NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE' .env.local | head -2`
Expected: URL contains `spllxotyxipdvfpkkvgu` (dev project ref per CLAUDE.md).

If env is pointing at prod, switch before proceeding.

- [ ] **Step 2: Apply the migration**

Run: `npx tsx scripts/migrate.ts supabase/migrations/0054_insights_channel.sql`
Expected output:
```
Applied: 0054_insights_channel
Tracker: wrote version 0054
```

If the tracker write fails, the migration itself has applied — inspect the script log to confirm.

- [ ] **Step 3: Verify the column + constraints exist on dev**

Run a quick verification via the Supabase SQL API (use `scripts/migrate.ts` helper pattern or a one-off probe). Acceptable manual verification: `psql` against dev using `SUPABASE_DB_URL` if available, otherwise a one-shot SQL file:

Create a throwaway check file `/tmp/check-0054.sql`:

```sql
SELECT column_name, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'treasury_insights' AND column_name = 'channel';

SELECT conname
  FROM pg_constraint
 WHERE conrelid = 'treasury_insights'::regclass
   AND conname LIKE 'treasury_insights_channel%';

SELECT indexname
  FROM pg_indexes
 WHERE tablename = 'treasury_insights'
   AND indexname = 'treasury_insights_channel_idx';

SELECT COUNT(*) FILTER (WHERE channel = 'deterministic') AS det,
       COUNT(*) FILTER (WHERE channel = 'advisory') AS adv,
       COUNT(*) AS total
  FROM treasury_insights;
```

Run via the Supabase Management API SQL endpoint (same method `migrate.ts` uses). Expected output:
- One `channel` column row with `column_default = 'deterministic'::text`, `is_nullable = NO`
- Two constraints: `treasury_insights_channel_values_check`, `treasury_insights_channel_fields_check`
- One index: `treasury_insights_channel_idx`
- `det` count equals `total`, `adv` count is 0

- [ ] **Step 4: Verify the CHECK constraint actually rejects bad input**

Run this verification SQL (will ROLLBACK — no rows created):

```sql
BEGIN;
  INSERT INTO treasury_insights (
    enterprise_id, user_id, detector_name, insight_type, severity,
    state, title, summary, channel, recommended_action
  ) VALUES (
    gen_random_uuid(), gen_random_uuid(), 'test', 'concentration_warning', 'info',
    'new', 't', 's', 'advisory',
    '{"type":"yield_deposit","fromVenueId":"x","toVenueId":"y","asset":"USDC","amount":1,"amountUsd":1}'::jsonb
  );
ROLLBACK;
```

Expected: CHECK constraint violation on `treasury_insights_channel_fields_check`. If the INSERT succeeds, migration is wrong — investigate before proceeding.

---

## Task 5: Apply migration to prod Supabase

**Files:**
- None (operation on live prod DB)

- [ ] **Step 1: Switch env to prod**

Flip `NEXT_PUBLIC_SUPABASE_URL` + service key to prod (`lfujbwemavgiifkltrag` per CLAUDE.md). If you use per-env `.env` files, export the prod values:

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://lfujbwemavgiifkltrag.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<prod service role key>"
```

- [ ] **Step 2: Re-verify env**

Run: `echo $NEXT_PUBLIC_SUPABASE_URL`
Expected: `https://lfujbwemavgiifkltrag.supabase.co`

Sanity check: you are about to apply a schema migration to production. Confirm before proceeding.

- [ ] **Step 3: Apply the migration**

Run: `npx tsx scripts/migrate.ts supabase/migrations/0054_insights_channel.sql`
Expected: same success output as Task 4 Step 2.

- [ ] **Step 4: Re-run verification queries against prod**

Same queries as Task 4 Step 3 (column / constraints / index existence, row counts). Expected the same shape — column exists, constraints present, all existing prod rows have `channel='deterministic'`.

- [ ] **Step 5: Re-run CHECK-violation test against prod**

Same ROLLBACK-wrapped INSERT as Task 4 Step 4. Expected: CHECK violation.

---

## Task 6: Update TypeScript types

**Files:**
- Modify: `src/lib/insights/types.ts`

- [ ] **Step 1: Write the failing type-check**

Append to `src/lib/insights/types.ts` (at the end of the file):

```ts
// (temporary type assertion — will be removed after Step 3)
const _channelTypeCheck: InsightChannel = 'deterministic';
```

- [ ] **Step 2: Run type check to verify it fails**

Run: `npx tsc --noEmit`
Expected: error — `Cannot find name 'InsightChannel'`.

- [ ] **Step 3: Define the type and extend DetectedInsight + TreasuryInsightRow**

Edit `src/lib/insights/types.ts`:

Find the section `// ─── Insight taxonomy ─────────────────────────────────────────────────` and add after the existing type aliases (after `DataFreshness` definition):

```ts
/**
 * Channel identifies whether an insight is a deterministic detector
 * output (actionable, can gate movement) or an advisory AI-authored
 * note (narrative only, never actionable). See spec §5.
 */
export type InsightChannel = 'deterministic' | 'advisory';
```

Then find the `DetectedInsight` interface and add `channel` as a required field:

```ts
export interface DetectedInsight {
  channel: InsightChannel;   // NEW — must be explicit
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  // ... rest unchanged
}
```

Find `TreasuryInsightRow` (should be later in the same file) and add the field to the row shape:

```ts
export interface TreasuryInsightRow {
  // ... existing fields
  channel: InsightChannel;   // NEW
  // ... rest unchanged
}
```

Remove the temporary `_channelTypeCheck` line from Step 1.

- [ ] **Step 4: Run type check to verify it passes in isolation**

Run: `npx tsc --noEmit`
Expected: the `_channelTypeCheck` error goes away. New errors should appear everywhere `DetectedInsight` is constructed (because `channel` is now required). Those are expected — they get fixed in Tasks 7 and 8.

Note the new errors for reference:
```
src/lib/insights/detectors/concentration.ts(...): Property 'channel' is missing...
src/lib/insights/detectors/liquidity.ts(...): Property 'channel' is missing...
src/lib/insights/detectors/yield-rebalance.ts(...): Property 'channel' is missing...
```

- [ ] **Step 5: Commit (types only, compilation currently broken)**

```bash
git add src/lib/insights/types.ts
git commit -m "feat(insights): add InsightChannel type to DetectedInsight and TreasuryInsightRow"
```

---

## Task 7: Thread `channel` through detectors

**Files:**
- Modify: `src/lib/insights/detectors/concentration.ts`
- Modify: `src/lib/insights/detectors/liquidity.ts`
- Modify: `src/lib/insights/detectors/yield-rebalance.ts`

- [ ] **Step 1: Write the failing test**

Edit `src/lib/insights/store.test.ts`. Find an existing test that constructs a `DetectedInsight` (there will be several — pick one near the top of a describe block). Add a new test after it:

```ts
it('defaults channel to deterministic when a detector produces an insight', () => {
  const insight: DetectedInsight = {
    channel: 'deterministic',
    type: 'concentration_warning',
    severity: 'info',
    title: 'test',
    summary: 'test',
    rationale: {},
    recommendedAction: null,
    impact: { dollarValue: 0 },
    confidence: 0.5,
    venueCategory: null,
    dedupKey: 'test-dedup',
    supportingData: {},
  };
  expect(insight.channel).toBe('deterministic');
});
```

Note: adjust the object literal to match whatever other `DetectedInsight`-shaped test objects look like in the file. The purpose is to pin channel='deterministic' at the type level.

- [ ] **Step 2: Run the existing detector tests to see failures from Task 6**

Run: `npx vitest run src/lib/insights/`
Expected: failures in detector runtime tests — the detector functions construct `DetectedInsight` literals without `channel`, which the type system now rejects.

- [ ] **Step 3: Update `concentration.ts` detector**

Open `src/lib/insights/detectors/concentration.ts`. Find each `return` statement that builds a `DetectedInsight` object. Add `channel: 'deterministic'` as the first field of each literal. Example transformation:

Before:
```ts
return {
  type: 'concentration_warning',
  severity: 'warning',
  title: 'USDC concentration approaching cap',
  summary: `...`,
  // ...
};
```

After:
```ts
return {
  channel: 'deterministic',
  type: 'concentration_warning',
  severity: 'warning',
  title: 'USDC concentration approaching cap',
  summary: `...`,
  // ...
};
```

Apply to every construction site in the file. If the file uses a helper function to build insights (e.g., `buildInsight(...)`), add `channel` there once instead.

- [ ] **Step 4: Update `liquidity.ts` detector**

Same pattern as Step 3 — open `src/lib/insights/detectors/liquidity.ts`, add `channel: 'deterministic'` to every `DetectedInsight` construction.

- [ ] **Step 5: Update `yield-rebalance.ts` detector**

Same pattern — open `src/lib/insights/detectors/yield-rebalance.ts`, add `channel: 'deterministic'` to every `DetectedInsight` construction.

- [ ] **Step 6: Run tests to verify detectors compile and emit channel**

Run: `npx vitest run src/lib/insights/`
Expected: all detector-related tests pass (green). If a test still fails with "Property 'channel' is missing", inspect that file for any missed construction sites.

- [ ] **Step 7: Commit**

```bash
git add src/lib/insights/detectors/ src/lib/insights/store.test.ts
git commit -m "feat(insights): emit channel='deterministic' from all existing detectors"
```

---

## Task 8: Thread `channel` through store persistence

**Files:**
- Modify: `src/lib/insights/store.ts`
- Modify: `src/lib/insights/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/insights/store.test.ts` within the existing `persist` describe block (or create one if none exists):

```ts
it('writes the channel field to treasury_insights on persist', async () => {
  const fakeSupabase = makeFakeSupabase();  // use the file's existing test helper
  const enterpriseId = 'ent-1';
  const userId = 'usr-1';

  await persist(fakeSupabase, {
    enterpriseId,
    userId,
    detectorName: 'test-detector',
    detected: {
      channel: 'deterministic',
      type: 'concentration_warning',
      severity: 'info',
      title: 't',
      summary: 's',
      rationale: {},
      recommendedAction: null,
      impact: { dollarValue: 0 },
      confidence: 0.5,
      venueCategory: null,
      dedupKey: 'dk-1',
      supportingData: {},
    },
    policyVerdict: null,
    policyReason: null,
  });

  const insertedRow = fakeSupabase.lastInsertedRow('treasury_insights');
  expect(insertedRow.channel).toBe('deterministic');
});
```

Adjust the `makeFakeSupabase` / `lastInsertedRow` helper names to match whatever `store.test.ts` already uses. If the test file mocks Supabase with vi.fn chains, mirror that style instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/insights/store.test.ts`
Expected: FAIL — `expect(undefined).toBe('deterministic')` because `persist` does not yet write `channel`.

- [ ] **Step 3: Update `persist` to write channel**

Open `src/lib/insights/store.ts`. Find the `persist` function (or equivalent — may be called `persistInsight`, `createInsight`, etc.). Locate the `.insert()` call into `treasury_insights`. Add `channel: input.detected.channel` to the insert payload.

Example (adjust to match actual code):

```ts
const { data, error } = await supabase
  .from('treasury_insights')
  .insert({
    enterprise_id: input.enterpriseId,
    user_id: input.userId,
    detector_name: input.detectorName,
    // ... existing fields
    channel: input.detected.channel,   // NEW
    // ...
  })
  .select()
  .single();
```

- [ ] **Step 4: Run tests to verify green**

Run: `npx vitest run src/lib/insights/`
Expected: PASS, all tests including the new channel assertion.

- [ ] **Step 5: Commit**

```bash
git add src/lib/insights/store.ts src/lib/insights/store.test.ts
git commit -m "feat(insights): persist channel column on insight insert"
```

---

## Task 9: Update database types (if hand-maintained)

**Files:**
- Modify: `src/types/database.ts` (only if hand-maintained)

- [ ] **Step 1: Determine if database.ts is generated or hand-maintained**

Run: `head -5 src/types/database.ts`
If the file begins with an auto-generated banner (e.g., `// DO NOT EDIT — generated by supabase gen types`), regenerate it per the repo's regeneration script and skip the manual edit.

If no banner, proceed.

- [ ] **Step 2: Find the treasury_insights Row type**

Run: `grep -n 'treasury_insights' src/types/database.ts | head -10`
Expected: lines pointing to `treasury_insights: { Row: {...} }` shape.

- [ ] **Step 3: Add channel to Row, Insert, Update**

Edit `src/types/database.ts`. Find the `treasury_insights` table entry and add `channel: string` (or `channel: 'deterministic' | 'advisory'` if the generator supports union literals) to:
- `Row`
- `Insert` (with `?` if it has a default)
- `Update` (with `?`)

Example:

```ts
treasury_insights: {
  Row: {
    // ... existing fields
    channel: string;   // NEW — 'deterministic' | 'advisory'
  };
  Insert: {
    // ... existing fields
    channel?: string;  // NEW
  };
  Update: {
    // ... existing fields
    channel?: string;  // NEW
  };
};
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/database.ts
git commit -m "types(db): add channel to treasury_insights Row/Insert/Update"
```

If regenerated (Step 1 took the auto path), commit with message: `types(db): regenerate after 0054 migration`.

---

## Task 10: Full test + type + build verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all tests pass. Current-master baseline is 1193 tests (per memory); this plan adds ~7 tests (4 NotePanel + 3 AgentSignature + store channel test), so target is ~1200 passing, 0 failing.

If any pre-existing tests fail, investigate before committing — the Phase 0 changes should be purely additive.

- [ ] **Step 2: Run the type checker standalone**

Run: `npx tsc --noEmit`
Expected: clean, no type errors.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: successful Next.js build. Watch for any runtime-level type errors that slipped past tsc.

Per the Vantor long-running-commands memory, `npm run build` can take several minutes — announce wait, check `tsc` as the primary signal.

- [ ] **Step 4: Smoke-check the new primitives render**

Start dev server: `npm run dev`

Open a browser to any page that already renders a `<Badge>` and visually confirm no regression. Then optionally drop a `<NotePanel>` into a dev-only test route (e.g., `src/app/(app)/dev/page.tsx` if that pattern exists) to confirm the purple tint renders correctly. Remove the test route before committing.

If no dev-route pattern exists, skip this step — the unit tests already verify DOM output.

- [ ] **Step 5: Commit any small fixups**

If steps 1-3 surfaced small fixups (missing imports, lint adjustments), commit them:

```bash
git add -p   # review hunks
git commit -m "chore(agent-surfaces): fixups from Phase 0 verification"
```

---

## Task 11: Push and open PR

**Files:** none (git + GitHub operation)

- [ ] **Step 1: Confirm git status is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean` on branch `feature/agent-surfaces-foundation`.

- [ ] **Step 2: Push the branch**

Run: `git push -u origin feature/agent-surfaces-foundation`
Expected: remote branch created.

- [ ] **Step 3: Open the PR**

Run:

```bash
gh pr create --title "feat(agent-surfaces): Phase 0 foundation — NotePanel, AgentSignature, channel column" --body "$(cat <<'EOF'
## Summary

Zero-user-visible foundation for the Agent Surfaces redesign (see `docs/superpowers/specs/2026-04-13-agent-surfaces-design.md`).

- New `<NotePanel>` primitive (purple-tinted editorial prose surface for Channel 2 notes)
- New `<AgentSignature>` composition helper (the canonical Agent Badge)
- Migration `0054_insights_channel.sql` adds `channel` column + CHECK constraint on `treasury_insights` — enforces the `channel2-advisory-only` invariant at the storage layer
- All existing detectors explicitly emit `channel='deterministic'`
- Store persists the channel through `.insert()`

## Test plan

- [ ] `npm run test` passes (baseline 1193 + ~7 new tests)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` succeeds
- [ ] Migration 0054 applied + verified on dev
- [ ] Migration 0054 applied + verified on prod
- [ ] CHECK constraint rejects advisory + recommended_action combination on both dev and prod

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Share it back for review.

---

## Self-Review

**1. Spec coverage (§11 of design doc):**
- §11.2.1 Extend `<QuotePanel>` → Task 1 (deviation: new `<NotePanel>` primitive instead — documented in plan header)
- §11.2.2 `<AgentSignature>` helper → Task 2
- §11.2.3 Migration 0054 → Tasks 3, 4, 5
- §11.2.4 Type update → Tasks 6, 9
- §11.2.5 Detector code updates → Tasks 7, 8

**2. Acceptance criteria coverage (§11.3 of design doc):**
- `npm run tsc` passes → Task 10 Step 2
- `npm run test` passes → Task 10 Step 1
- Existing `<QuotePanel>` usages render identically → Preserved by creating new primitive rather than modifying
- `<NotePanel>` renders with purple tint → Task 1 Step 1 (class-level assertion)
- `<AgentSignature>` renders a purple "Agent" badge → Task 2 Step 1
- Migration applies cleanly on dev → Task 4 Step 2
- Migration applies cleanly on prod → Task 5 Step 3
- CHECK constraint rejects bad input → Task 4 Step 4, Task 5 Step 5
- All existing rows have `channel='deterministic'` → Task 4 Step 3 (count assertion)
- No user-visible change → Task 10 Step 4

**3. Placeholder scan:** No TBDs, TODOs, or "add appropriate" instructions. All code blocks contain actual code. All commands are exact. One legitimate caveat flagged inline ("if database.ts is auto-generated, regenerate instead") — this is unavoidable since I don't know without probing.

**4. Type consistency:** `InsightChannel` used in Tasks 6, 7, 8 with consistent values `'deterministic' | 'advisory'`. `NotePanel` props (`eyebrow`, `heading`, `children`, `signature`, `className`) used consistently across Task 1 Step 1 (test) and Step 3 (impl). `AgentSignature` has only `subtle?: boolean`, used identically in Task 2 Step 1 and 3.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-13-agent-surfaces-foundation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
