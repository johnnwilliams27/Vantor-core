# Vantor Style Guide — Staged Implementation Spec

**Date:** 2026-04-12
**Branch:** `feature/style-guide`
**Visual spec:** `docs/style-guide.html`
**Status:** Plan — not yet executed

---

## Overview

The Vantor Style Guide (at `docs/style-guide.html`) formalizes the full visual system across 16 sections — buttons, badges, icon containers, status dots, cards, form inputs, tabs, switches, avatars, progress, typography, color tokens, spacing, elevation, motion, empty states.

This spec maps each section's decisions to concrete codebase migrations, grouped into **5 shippable stages**. Each stage is one PR. Stages are ordered by risk and dependency:

| Stage | Scope | Risk | PR count |
|---|---|---|---|
| **1 · Foundation** | Tokens, Satoshi font, L1 primary color, CSS vars | Zero regression (additive only) | 1 |
| **2 · Primitives** | Extend Button/Badge/Card/Input; new IconTile/StatusDot/Avatar/specialized cards | Low (new APIs, existing usage intact) | 1-2 |
| **3 · Migration** | Retire ~100 inline patterns across modules | Medium (large diff, visual regressions possible) | 4-6 (split by module) |
| **4 · Deviations** | Fix known inconsistencies from original audit | Low (surgical) | 1 |
| **5 · Empty states** | Replace 3 dashboard empty states | Low | 1 |

---

## Locked design decisions (from style-guide.html)

Before any code moves, these are the rules the implementation must respect:

### Shape system
- `rounded-md` (6px) → badges, pills, chips
- `rounded-lg` (8px) → buttons, inputs, cards
- `rounded-xl` (12px) → **not used anymore** (cards moved to rounded-lg)
- `rounded-full` → dots, count overlays, progress bars, switches, avatars (shape-mandated only)

### Color system
- **Brand gradient** `#2dd4bf → #67e8f9` → Tier 1 only (landing hero, navbar Login, ContactForm)
- **Primary solid L1** `hsl(172 66% 30%)` ≈ `#1A7F71` → Tier 2 (auth flows + entire app)
- **Semantic palette** (8 colors):
  - teal = active / healthy / executed
  - amber = pending / attention-needed
  - red = failed / critical / blocked
  - blue = info / neutral-positive
  - purple = special / AI / tier
  - gray = inactive / cancelled / archived
  - rose = urgent / overdue / unread
  - green = live / system-healthy (narrow use — Test/Live mode only)
- **Opacity rules:** bg `/8` or `/10`, border `/20`, full color for icons/text

### Typography
- **Body:** Satoshi (Fontshare, free)
- **Mono:** SF Mono, Menlo, Consolas
- **Features:** `tnum` on, `lnum` on globally
- **Weights:** 400 body / 500 emphasis / 700 heading+button

### Elevation
- **Flat** → no shadow (table rows, page bg)
- **Subtle** → `0 1px 2px rgba(0,0,0,0.25)` (buttons, inputs)
- **Default** → `0 2px 6px rgba(0,0,0,0.25)` (cards)
- **Elevated** → `0 12px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3)` (dialogs, popovers)

### Motion
- **Snappy** 100ms · **Default** 150ms · **Smooth** 200ms · **Slow** 300ms
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)` natural / `ease` default / `cubic-bezier(0.4, 0, 0.6, 1)` symmetric / `linear` spinners only
- **Reduced motion** respected via `@media (prefers-reduced-motion: reduce)`

---

## Stage 1 · Foundation

**Goal:** introduce all new tokens + fonts + color vars. No component behavior changes. Zero visual regressions.

### 1.1 — Font loading

**File:** `src/app/layout.tsx` (or wherever `<head>` is configured)

Add Fontshare Satoshi via `<link>` or Next.js font loader. Prefer Next.js `next/font/local` with downloaded Satoshi OTF files for optimal loading.

Alternative (CSS import):
```tsx
<link
  rel="preconnect"
  href="https://api.fontshare.com"
/>
<link
  href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"
  rel="stylesheet"
/>
```

**File:** `tailwind.config.ts`

```ts
theme: {
  extend: {
    fontFamily: {
      sans: ['Satoshi', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      mono: ['SF Mono', 'Menlo', 'Consolas', 'monospace'],
    },
  },
},
```

**File:** `src/app/globals.css`

Add body-level font-feature-settings:
```css
body {
  font-feature-settings: 'tnum' on, 'lnum' on;
}
```

### 1.2 — Color tokens

**File:** `src/app/globals.css`

Update `:root.dark` block:
```css
.dark {
  /* BEFORE: --primary: 182 58% 28%; */
  --primary: 172 66% 30%;        /* L1 locked */
  --primary-foreground: 0 0% 100%;

  /* Add semantic foundations (currently scattered inline) */
  --focus-ring: 172 77% 51%;     /* teal-400 for focus rings */

  /* Surface scale */
  --surface-void: 218 64% 7%;       /* #060d1f */
  --surface-deep: 219 64% 5%;       /* #040a18 */
  --surface-card: 218 49% 12%;      /* #0e1a2e */
  --surface-elevated: 217 51% 10%;  /* #0a1628 */
}
```

### 1.3 — Shadow scale

**File:** `tailwind.config.ts` (or `globals.css` as CSS vars)

```ts
boxShadow: {
  'btn': '0 1px 2px rgba(0,0,0,0.25)',
  'card': '0 2px 6px rgba(0,0,0,0.25)',
  'elevated': '0 12px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3)',
},
```

### 1.4 — Accept criteria

- App builds without errors
- `Satoshi` renders on every page (inspect element, verify `font-family` contains Satoshi)
- `--primary` CSS var resolves to L1 teal (verify in devtools)
- No visual regressions — every button still renders, every card still has correct bg
- Existing `btn-gradient` class still works unchanged (it stays rounded-full in this stage — shape fix comes in Stage 3)

---

## Stage 2 · Primitives

**Goal:** extend/create all primitives with the new APIs. Old usage continues to work.

### 2.1 — `Button` extension (`src/components/ui/button.tsx`)

Add new variants to the CVA:
```ts
variants: {
  variant: {
    default: '...',          // keep existing
    destructive: '...',      // keep existing
    outline: '...',          // keep existing
    secondary: '...',        // keep existing
    ghost: '...',            // keep existing
    link: '...',             // keep existing

    // NEW — Tier 1 gradient for brand surfaces
    primary: 'bg-gradient-to-r from-teal-400 to-cyan-300 text-[var(--bg-void)] font-semibold rounded-lg shadow-btn hover:-translate-y-px active:scale-[0.98]',

    // NEW — destructive-outline (retires the 6 wrong red-palette sites)
    'destructive-outline': 'border border-red-500/20 bg-transparent text-red-400 hover:bg-red-500/10',
  },
},
```

### 2.2 — `ConfirmDialog` extension (`src/components/ui/confirm-dialog.tsx`)

Change `variant` prop type from `'destructive' | 'default'` to `'destructive' | 'default' | 'primary'`.

Map to `<Button variant="primary">` (gradient) when `variant="primary"` is passed.

### 2.3 — `Badge` extension (`src/components/ui/badge.tsx`)

Replace rounded-full with rounded-md. Add:
```ts
variant: 'active' | 'pending' | 'failed' | 'info' | 'special' | 'inactive' | 'urgent' | 'live'
size: 'xs' | 'sm' | 'md' | 'lg'   // default 'sm'
dot?: boolean
icon?: React.ReactNode
```

Create `src/lib/design/badges.ts`:
```ts
export const BADGE = {
  active:    'bg-teal-500/8 text-teal-400 border-teal-500/20',
  pending:   'bg-amber-500/8 text-amber-400 border-amber-500/20',
  failed:    'bg-red-500/8 text-red-400 border-red-500/20',
  info:      'bg-blue-500/8 text-blue-400 border-blue-500/20',
  special:   'bg-purple-500/8 text-purple-400 border-purple-500/20',
  inactive:  'bg-gray-500/10 text-gray-400 border-gray-500/20',
  urgent:    'bg-rose-500/10 text-rose-400 border-rose-500/20',
  live:      'bg-green-500/8 text-green-400 border-green-500/20',
} as const;

export const STATUS_BADGE = {
  executed: BADGE.active,
  connected: BADGE.active,
  fresh: BADGE.active,
  pending: BADGE.pending,
  scheduled: BADGE.pending,
  stale: BADGE.pending,
  failed: BADGE.failed,
  blocked: BADGE.failed,
  cancelled: BADGE.inactive,
  archived: BADGE.inactive,
  draft: BADGE.inactive,
} as const;
```

### 2.4 — `Card` extension (`src/components/ui/card.tsx`)

- Change `rounded-xl` → `rounded-lg`
- Add `shadow-card` default (subtle shadow per locked decision)
- Add variants: `default` / `elevated` / `interactive` / `quote`
- Interactive hover: no lift — border-brighten toward teal + bg lighten
- Create `CardHeader` with props: `icon`, `title`, `subtitle`, `trailing`

### 2.5 — `Input` extension (`src/components/ui/input.tsx`)

- Change `rounded-md` → `rounded-lg`
- Add subtle fill `bg-white/[0.03]`
- Add `size` prop: `sm` (h-9) / default (h-10) / `lg` (h-11)
- Add `leadingIcon` / `trailingIcon` props
- Add `error` prop that toggles red border + aria-invalid

Create composed wrapper at `src/components/ui/field.tsx`:
```tsx
<Field label="Amount" required helper="Enter without commas" error={errors.amount}>
  <Input {...register('amount')} />
</Field>
```

### 2.6 — New primitives

Create these files:

- `src/components/ui/icon-tile.tsx` — 5 sizes × 14 variants × 2 shapes (see Section 03 of style-guide.html)
- `src/components/ui/status-dot.tsx` — 3 sizes × 8 variants + `pulse` / `ring` / `label` props (Section 04)
- `src/components/ui/avatar.tsx` — 4 sizes + hash-derived bg color from 8-semantic palette + optional presence indicator (Section 09)
- `src/components/ui/freshness-badge.tsx` — composite using Badge + StatusDot (already partially defined in Section 02)
- `src/components/ui/count-badge.tsx` — micro count overlay (rounded-full, shape-mandated)

### 2.7 — Specialized card primitives (Section 05)

Create:
- `src/components/ui/stat-card.tsx` — icon + label + value + trend
- `src/components/ui/quote-panel.tsx` — teal tinted surface with quote layout (absorbs `bg-[#0a2a2a]` hardcoded hex)
- `src/components/ui/empty-state-card.tsx` — centered IconTile + headline + helper + CTA (for Section 16)
- `src/components/ui/table-card.tsx` — card wrapper around a full-width table with header bar

### 2.8 — Accept criteria

- All new primitives render correctly with sample props
- Existing callers continue working (no breaking changes to Button/Badge/Card/Input signatures)
- `<Badge variant="active" dot />` renders as rounded-md teal tinted badge with leading dot
- `<ConfirmDialog variant="primary">` renders gradient confirm button
- Unit test coverage for the new variant/size prop combinations

---

## Stage 3 · Migration

**Goal:** retire inline patterns across the app. This is the heavy sweep.

Split into multiple PRs by module to keep diffs reviewable:

### 3.1 — Dashboard + Treasury (PR 3a)

Surfaces: `src/app/(app)/dashboard/`, `src/components/treasury/`, `src/components/charts/`

Tasks:
- Replace inline badge classNames with `<Badge variant={STATUS_BADGE[status]}>` everywhere
- Replace inline `<span className="h-*-*-rounded-full bg-*">` dot patterns with `<StatusDot variant={...}>`
- Replace inline `<div className="rounded-xl border...">` card wrappers with `<Card>`
- Replace RecommendationCard header with `<CardHeader>` primitive

**Known files:**
- `src/components/treasury/RecommendationCard.tsx`
- `src/components/treasury/InsightCard.tsx`
- `src/components/treasury/UnifiedBalanceCard.tsx`
- `src/components/treasury/TreasuryHealthCard.tsx`
- `src/components/treasury/ObligationsPanel.tsx`
- `src/components/charts/RecommendationsCard.tsx`
- `src/components/charts/YieldEarned.tsx`
- `src/components/charts/TokenDistribution.tsx`
- `src/components/charts/BalanceOverTime.tsx`

### 3.2 — Operations forms (PR 3b)

Surfaces: `src/components/banking/`, `src/components/swaps/`, `src/components/transfers/`, `src/components/payments/`, `src/components/bridges/`, `src/components/scheduled/`

Tasks:
- Retire inline `STATUS_COLORS` maps in `transfers/page.tsx:25`, `payments/page.tsx:32`, `ScheduledOperationsTable.tsx:21`
- Replace with `BADGE_STATUS` from central constant
- Convert hardcoded quote panel markup to `<QuotePanel>` primitive
- `<Input>` usages pick up `size` prop where needed

### 3.3 — Connections (PR 3c)

Surfaces: `src/components/wallets/`, `src/components/banking/BankAccountsTab.tsx`, `src/app/(app)/settings/erp/`, `src/app/(app)/settings/integrations/`

Tasks:
- Replace chain tiles inline with `<IconTile variant="brand-eth|brand-sol">`
- Replace Slack/Teams/Email/etc tiles with `<IconTile variant="brand-slack|brand-teams|...">`
- Convert integration cards to `<Card variant="interactive">`

### 3.4 — Tables + Transactions (PR 3d)

Surfaces: `src/components/transactions/`, `src/components/compliance/`, `src/components/invoices/`, `src/components/analytics/`

Tasks:
- Retire `TYPE_BADGE` map in `AllTab.tsx:240` → central constant
- Retire `SEVERITY_COLORS` + `STATUS_COLORS` in `KytAlertsTable.tsx`
- Retire `CHART_BADGES` in `ViewListRow.tsx:22`
- Retire `RESULT_BADGE` in `SanctionsScreeningPanel.tsx`
- Wrap tables in `<TableCard>` where currently wrapped ad-hoc

### 3.5 — Settings + Admin (PR 3e)

Surfaces: `src/app/(app)/settings/`, `src/app/(admin)/`, `src/components/billing/`

Tasks:
- Retire `ROLE_BADGE` in `settings/accounts/page.tsx:52` → central constant
- Retire inline status badges in `admin/page.tsx:35` + `admin/enterprises/[id]/page.tsx:35`
- Avatar conversions in `SettingsMenu.tsx:86` (user chip) + `settings/accounts/page.tsx:600` (user list)
- Billing PlanTab / UpgradeFlow icon tiles → `<IconTile>`
- `OnboardingWizard.tsx:256` circular emerald icon → `<IconTile variant="live" shape="circle" size="xl">`

### 3.6 — Landing + Auth (PR 3f)

Surfaces: `src/components/landing/`, `src/components/auth/`, `src/app/(auth)/`

Tasks:
- `btn-gradient` CSS class shape fix: `border-radius: 9999px` → `8px` (globals.css:328)
- Strip the 44px halo: `box-shadow: 0 0 44px rgba(45, 212, 191, 0.32)` → none (globals.css:331)
- Verify landing Hero, Navbar Login, ContactForm still look right
- Auth forms (LoginForm/RegisterForm/ForgotPasswordForm/ResetPasswordForm/verify-email) — migrate from `btn-gradient` raw buttons to `<Button variant="primary">` (Tier 2 solid — they're auth, not brand)

### 3.7 — Accept criteria per PR

- Build green
- Unit tests pass
- No regression in visual QA (spot-check affected pages)
- No remaining inline badge/dot/card/icon-tile patterns in the touched module (grep)

---

## Stage 4 · Deviation fixes

**Goal:** resolve the 6 known deviations from the original audit.

These are surgical. Single PR.

### D1 — ConfirmDialog `variant="default"` callers → `variant="primary"`

Migrate ~6-8 sites that pass solid teal where gradient is expected:
- `src/components/layout/TestModeToggle.tsx:109` — "Go Live" / "Enter Test Mode"
- `src/components/invoices/PayInvoiceModal.tsx` — confirm
- `src/components/treasury/ApprovalModal.tsx` — approve
- `src/components/treasury/ReviewRecommendationModal.tsx` — approve
- `src/app/(app)/settings/accounts/page.tsx` — role change confirm
- `src/app/(admin)/admin/...` — admin confirms

### D2 — Destructive outline red palette

6 sites using `text-red-600 border-red-300 hover:bg-red-50` (light-mode palette that washes out on dark) → `variant="destructive-outline"` (uses red-400/red-500/20):

- `src/components/scheduled/ScheduledOperationsTable.tsx:150`
- `src/components/scheduled/ScheduledOperationsTable.tsx:198`
- `src/components/transfers/ApprovalModal.tsx:230`
- `src/components/transfers/ApprovalModal.tsx:263`
- `src/components/treasury/ReviewRecommendationModal.tsx:129`
- `src/components/treasury/ReviewRecommendationModal.tsx:205`

### D3 — SlippageWarning red severity

`src/components/yield/SlippageWarning.tsx:137-144` — inline `bg-red-600 hover:bg-red-700` solid red → `variant="destructive-outline"`

### D4 — Admin enterprise freeze button

`src/app/(admin)/admin/enterprises/[id]/page.tsx:147` — `variant="destructive"` (shadcn default red) → `variant="destructive-outline"` (Vantor palette)

### D5 — CancelScheduledDialog Go Back

`src/components/ui/cancel-scheduled-dialog.tsx:55` — add `variant="outline"` (currently defaults to primary which is wrong for a "Go Back" button)

### D6 — OnboardingWizard hardcoded teal

`src/components/setup/OnboardingWizard.tsx:287` — `className="bg-[#19595b] hover:bg-[#134849]"` → use `<Button variant="primary">` (L1 solid teal via token)

Also `OnboardingWizard.tsx:562` — hardcoded `bg-[#19595b]` on selected role dot → `bg-primary`

### D7 — Accept criteria

- All 6 deviations rendered correctly in dark mode (visual QA)
- Red buttons are legibly red (not washed out)
- TestModeToggle "Go Live" button now renders as gradient pill (Tier 1 style) — this is the original ask that kicked off the entire style-guide work

---

## Stage 5 · Empty states

**Goal:** resolve the 3 dashboard empty states from the original conversation using the `<EmptyStateCard>` primitive.

### 5.1 — UnifiedBalanceCard empty state

`src/components/treasury/UnifiedBalanceCard.tsx:338`

Before:
```tsx
<div className="text-sm text-muted-foreground py-4">
  No yield positions active. <a href="/yield" className="text-primary hover:underline">Explore yield opportunities →</a>
</div>
```

After:
```tsx
<EmptyStateCard
  icon={<TrendingUp />}
  variant="active"   // teal — feature not yet activated
  title="No active positions"
  helper="Start earning on idle stablecoins via Aave, Compound, and MMF partners."
  cta={<Button variant="default" size="sm" asChild><Link href="/yield">Explore yield</Link></Button>}
/>
```

### 5.2 — YieldEarned chart empty state

`src/components/charts/YieldEarned.tsx:152`

Replace plain muted text + underlined link with `<EmptyStateCard variant="active">` centered inside the card.

### 5.3 — RecommendationsCard empty state

`src/components/charts/RecommendationsCard.tsx:452`

Use `<EmptyStateCard variant="special">` (purple — AI-not-configured) with title "No AI insights yet" + CTA "Configure rules" → `/treasury?tab=rules`.

### 5.4 — Accept criteria

- All 3 dashboard empty states render via `<EmptyStateCard>`
- CTAs use semantic-appropriate variant colors (teal for yield/active, purple for AI-not-configured)
- No remaining `<a href=... className="text-primary hover:underline">CTA →</a>` patterns inside `<div className="py-4">` wrappers across dashboard surfaces

---

## Rollback plan

Each stage is isolated enough to revert independently:

| Stage | Rollback complexity |
|---|---|
| 1 · Foundation | Low — revert `globals.css` + `tailwind.config.ts` + font loader. L1 `--primary` reverts to prior value. |
| 2 · Primitives | Low — new files can be deleted; old Button/Badge/Card/Input code paths are untouched. |
| 3 · Migration | Medium — each sub-PR is independently revertable. Keep PRs 3a-3f small for easy rollback. |
| 4 · Deviations | Low — touches ≤10 files, surgical revert possible per file. |
| 5 · Empty states | Low — 3 components, easy revert. |

**Guardrails:**
- Stage 1 lands and runs in production for at least 1 day before Stage 2 lands
- Stage 2 similarly lands and lives before Stage 3a begins
- Each sub-PR in Stage 3 (3a–3f) gets its own visual QA round before the next module starts

---

## Migration tracker (running count)

| Pattern | Before | After |
|---|---|---|
| Inline badge color maps | 10 scattered | 1 central constant in `src/lib/design/badges.ts` |
| Inline icon tile patterns (`w-* h-* rounded-lg bg-*-500/10`) | ~25 sites | 1 primitive: `<IconTile>` |
| Inline status dot patterns (`h-*-* w-*-* rounded-full bg-*`) | ~25 sites | 1 primitive: `<StatusDot>` |
| Ad-hoc card wrappers (`<div className="rounded-xl border border-white/[0.08]...">`) | ~60 sites | 1 primitive: `<Card>` (+ specialized `StatCard` / `QuotePanel` / `TableCard` / `EmptyStateCard`) |
| Avatar divs with hardcoded colors | ~5 sites | 1 primitive: `<Avatar>` |
| Hardcoded teal `#19595b` | ~3 sites | `bg-primary` (L1 token) |
| Wrong-palette destructive outline (red-600/red-300) | 6 sites | `<Button variant="destructive-outline">` |

**Total inline pattern sites retired: ~125-140.**

---

## What this spec does NOT include

- **Visual QA process** — assumed to exist (or be added). Each PR merge should include side-by-side screenshots of affected pages.
- **Unit tests for primitives** — should be added as each primitive is created in Stage 2. Aim for one test per variant/size combination.
- **Storybook** — Vantor doesn't currently use Storybook. Not adding it as part of this spec, but it would be a natural fit for a future stage.
- **Dark/light mode parity** — Vantor is dark-only. If light mode is added later, the semantic palette needs lighter equivalents defined.
- **Accessibility audit** — every primitive should already follow WCAG AA (focus rings, aria labels, touch targets ≥44px for page-level). Spot-check during Stage 2 creation.

---

## Handoff notes

- **Visual spec file:** `docs/style-guide.html` lives in this branch. Open in any browser. It's the canonical reference.
- **Font loading:** Satoshi is served from Fontshare's CDN. If Vantor ever wants to self-host, download the OTF from fontshare.com/fonts/satoshi and use `next/font/local`.
- **Opacity conventions:** always `bg-{color}-500/8` or `/10` for tints, `/20` for borders, full color for icons/text. Never apply opacity to foreground text — use the direct palette variant.
- **Shape conventions:** before adding `rounded-full` to any text-carrying element, ask "is this a circle by nature?" If no, use `rounded-md` (badge) or `rounded-lg` (button/input/card).
- **Any new component** should reference `docs/style-guide.html` Section N for precedent before inventing a new pattern.

---

## Open questions for future sessions

- Should the style guide be relocated to a Next.js admin route at `src/app/(admin)/style-guide/page.tsx` so it can be viewed alongside live app surfaces? Requires converting HTML → JSX.
- Should we add Storybook to the repo as a formal component playground? Good for scale but adds build-time tax.
- Should the semantic color tokens become CSS variables (`--color-active`, `--color-pending`, etc.) instead of Tailwind utilities? Would enable theming without a config change.

None of these block execution. All are optional follow-ups once the 5 stages ship.
