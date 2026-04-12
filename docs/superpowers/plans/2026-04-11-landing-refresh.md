# Landing Page Refresh — v5.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1123-line monolithic `src/app/page.tsx` with the v5.6 geometric-editorial landing page, extracted into focused components under `src/components/landing/`, with desktop-showcase animation and considerate-not-constraining mobile fallbacks.

**Architecture:** Thin composition root in `page.tsx` that mounts 11 focused landing components. Desktop keeps the full motion budget (mesh canvas, blob backdrop, SVG offset-path particle diagram, orb pulse). Mobile gets graceful fallbacks per section — most notably the AI Flow diagram switches to a simpler beam-and-orb layout below the `lg:` breakpoint instead of trying to reflow the desktop SVG.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS (default breakpoints, no custom), Inter via `next/font/google` (already loaded in `layout.tsx`), lucide-react icons (already in deps), CSS keyframes + SVG `offset-path` for motion (no Framer Motion). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-11-landing-refresh-design.md` is the source of truth. Read it before starting.

**Visual reference:** `landing-v5-preview.html` at the repo root (1320 lines). Open it in a browser to see the target.

---

## Validation Strategy

This is a visual frontend refactor on a codebase with **no React component test infrastructure** — `vitest.config.ts` uses `environment: node`, no jsdom, no React Testing Library, all existing tests are server/data-layer (forecast, obligations, treasury). Inventing test infrastructure inside this PR is the wrong blast radius.

**Per-task gate (cheap, runs in seconds):**
1. `npx tsc --noEmit` — zero new TypeScript errors
2. `npm run dev` and browse to `http://localhost:3000` — verify the section being built renders correctly at 1440px desktop and 360px mobile (DevTools device toolbar)
3. `git commit` only after the eye-check passes

**Final gate (Task 14, runs once):**
- `npm run build` — `next build` zero errors, zero new lint warnings
- Manual mobile audit at 360 / 414 / 768 / 1024 / 1440 / 1920
- Lighthouse mobile (Moto G Power, 4G simulation): Performance ≥ 85, Accessibility ≥ 95, Best Practices ≥ 95
- Sign-in still authenticates against NextAuth (test with a real seeded user)
- Contact form still POSTs to `/api/contact`
- `prefers-reduced-motion: reduce` toggle off + on, verify NetworkCanvas hides and orb pulse stops
- Keyboard tab order check

If any per-task check fails, fix it before moving on. The whole point of small commits is that rollback is one revert.

---

## File Structure

### Files to create

```
src/components/landing/
  Navbar.tsx              # extracted from page.tsx:341-573, adds mobile sheet
  HeroBackdrop.tsx        # composes NetworkCanvas + BlobBackground with density props
  NetworkCanvas.tsx       # extracted from page.tsx:65-323, particle count prop
  BlobBackground.tsx      # extracted from page.tsx:328-336, blur radius prop
  Hero.tsx                # rebuilt without metric pills, headline + sub-pitch + 2 CTAs
  CapabilityGrid.tsx      # 6 cards, 3x2 -> 2x3 -> 1col, pure void background
  TrustBand.tsx           # 6 pillars, max-w-4xl, includes new Enterprise-Grade Security pillar
  FeatureCarousel.tsx     # 3 slides, dot nav, touch swipe, no autoplay
  InsightFeed.tsx         # 5-card rotation, aria-live=polite, pause on hover/focus
  AIFlowDiagram.tsx       # SVG diagram, desktop offset-path particles, mobile beam fallback
  AIFlow.tsx              # section shell composing diagram + feed + 4-step narrative
  ContactForm.tsx         # extracted from page.tsx:957-1073, iOS auto-zoom fix
  Footer.tsx              # extracted from page.tsx:1078-1100
  index.ts                # barrel re-export
```

### Files to modify

```
src/app/page.tsx          # rewritten as a thin composition root (~30 lines)
src/app/globals.css       # add color tokens, focus-visible ring, prefers-reduced-motion rule
                          # Dead CSS purge happens in Task 13 ONLY after the new page is green
```

### Files to delete (Task 13, after the new page renders)

Nothing — every "old component" is currently inlined inside `page.tsx`, not in separate files. Task 13 removes the inlined definitions when it rewrites `page.tsx` as the thin root.

### Dead CSS to purge from `globals.css` (Task 13)

- `.blob-wrap`, `.blob`, `.blob-1`, `.blob-2`, `.blob-3`, `@keyframes blobFloat1/2/3` (lines 132-185) — moved into `BlobBackground.tsx` as inline styles in Task 3
- `.partner-scroll-track`, `@keyframes partnerScroll` (lines 219-233) — partner strip is vetoed
- `.hero-badge-glow`, `@keyframes badgePulse` (lines 236-243) — hero metric pills are vetoed

Keep `.landing-fade-in`, `.landing-delay-1..4`, `@keyframes landingFadeIn`, `.login-dropdown*` — still used by the new page.

---

## Color Tokens (added in Task 1, used by every component)

These get added to `globals.css` once and then every component references them via `var(--...)`.

```css
:root {
  --bg-void: #060d1f;
  --bg-deep-navy: #040a18;
  --teal-400: #2dd4bf;
  --cyan-300: #67e8f9;
  --text-100: #e5e7eb;
  --text-200: #d1d5db;
  --text-300: #9ca3af;  /* footer / slide-counter — was #6b7280 in v5.4, bumped in v5.5 a11y pass */
  --text-400: #6b7280;
}
```

---

## Locked Copy Reference (used by Tasks 4, 5, 6, 8, 10)

Pulled from spec §5 so the engineer never has to context-switch:

- **Hero h1 line 1:** `Put Your Idle Treasury`
- **Hero h1 line 2 (gradient teal→cyan):** `Reserves to Work`
- **Hero sub-pitch:** `Vantor provides full visibility across your cash and stablecoin reserves. Powerful AI insights assess upcoming obligations while surfacing yield opportunities and hedging FX exposure — always with a human in the loop.`
- **Hero CTAs:** `Get Started Free` (gradient pill, href `/register`) · `Explore Platform` (outline, href `#platform`)
- **AI Flow section title:** `Agentic intelligence, human control`
- **AI Flow inputs (4):** `Upcoming AR/AP` · `Cash · Banks + Wallets` · `Treasury Policy` · `FX Exposure`
- **AI Flow outputs (4):** `Spiko USD` · `Circle USYC` · `FX Rebalance` · `Payments`
- **AI Flow center node label:** `Vantor AI`
- **Insight feed (5 cards, all use the same teal `Approve?` pill):**
  1. `$2.3M idle USDC → Spiko USD · +4.9% APY`
  2. `€1.8M payroll due → convert USD to EUR`
  3. `$500K vendor payment → withdraw Circle USYC`
  4. `$4.5M outbound wire → manager approval required`
  5. `$1.2M Spiko USD · 4.9% → Circle USYC · +5.1% APY`
- **4-step narrative cards:** Analyze · Propose · Approve · Execute (full descriptions in current `page.tsx:838-842` — extract verbatim in Task 10)
- **Capability grid title:** `Modern treasury management — powered by AI`
- **Capability cards (6, NO "Vantor" prefix):**
  - **Command Center** — Cash Visibility · AI Insights · Asset Management · AI Agent Chat
  - **Treasury** — AI Treasury Rules · Payments Operations · Approval Workflows · FX Rebalancing
  - **Yield** — Tokenized MMFs · DeFi Yield Protocols · AI Risk Management · AI Yield Insights
  - **Compliance** — Sanctions Screening · Transaction Monitoring · Know Your Transaction · Travel Rule Enforcement
  - **Connect** — Bank Integrations · Wallet Integrations · ERP Integrations · Slack Connector
  - **Data** — AI Forecasting · Advanced Analytics · Audit Trail · Detailed Reporting
- **Trust band pillars (6):**
  1. **AML & Sanctions Screening** — Automated anti-money laundering checks and real-time sanctions screening against OFAC, EU, and UN lists on every transaction.
  2. **Transaction Monitoring** — Continuous monitoring of all on-chain and off-chain transactions. Pattern detection, velocity checks, and anomalous behavior alerting.
  3. **Audit Logging & Explainability** — Immutable audit trail for every action — human and AI. Full decision provenance so you can explain exactly why any action was taken.
  4. **Role-Based Permissions** — Granular RBAC with treasury manager, analyst, viewer, and admin roles. Enforce least-privilege access across your entire organization.
  5. **Approval Workflows** — Configurable multi-level approval chains. High-value transactions require multiple authorized signers before execution.
  6. **Enterprise-Grade Security** — End-to-end encryption, hardened infrastructure, and continuous monitoring — the security posture enterprise treasury teams expect.

---

## Task 1: Scaffold landing/, add color tokens, wire empty page.tsx

**Goal:** Get the directory structure, color tokens, and a thin `page.tsx` composition root in place — with empty stub components — so every subsequent task just fills in one stub at a time. After this task, the page renders white space, but the routing/imports are proven.

**Files:**
- Create: `src/components/landing/Navbar.tsx`
- Create: `src/components/landing/HeroBackdrop.tsx`
- Create: `src/components/landing/NetworkCanvas.tsx`
- Create: `src/components/landing/BlobBackground.tsx`
- Create: `src/components/landing/Hero.tsx`
- Create: `src/components/landing/CapabilityGrid.tsx`
- Create: `src/components/landing/TrustBand.tsx`
- Create: `src/components/landing/FeatureCarousel.tsx`
- Create: `src/components/landing/InsightFeed.tsx`
- Create: `src/components/landing/AIFlowDiagram.tsx`
- Create: `src/components/landing/AIFlow.tsx`
- Create: `src/components/landing/ContactForm.tsx`
- Create: `src/components/landing/Footer.tsx`
- Create: `src/components/landing/index.ts`
- Modify: `src/app/globals.css` (add tokens, do NOT touch existing classes)

**Important:** Do NOT modify `src/app/page.tsx` in this task. The current 1123-line page keeps working as-is until Task 13. The new components live alongside it but are unmounted.

- [ ] **Step 1: Create the landing/ directory structure with empty stubs**

Create each of the 13 component files with this exact content (replacing `Navbar` with the appropriate component name):

```tsx
// src/components/landing/Navbar.tsx
'use client';
export function Navbar() {
  return <div data-stub="Navbar" />;
}
```

Repeat for `HeroBackdrop`, `NetworkCanvas`, `BlobBackground`, `Hero`, `CapabilityGrid`, `TrustBand`, `FeatureCarousel`, `InsightFeed`, `AIFlowDiagram`, `AIFlow`, `ContactForm`, `Footer`. Each is a named export, each is a `'use client'` file.

- [ ] **Step 2: Create the barrel re-export**

```tsx
// src/components/landing/index.ts
export { Navbar } from './Navbar';
export { HeroBackdrop } from './HeroBackdrop';
export { NetworkCanvas } from './NetworkCanvas';
export { BlobBackground } from './BlobBackground';
export { Hero } from './Hero';
export { CapabilityGrid } from './CapabilityGrid';
export { TrustBand } from './TrustBand';
export { FeatureCarousel } from './FeatureCarousel';
export { InsightFeed } from './InsightFeed';
export { AIFlowDiagram } from './AIFlowDiagram';
export { AIFlow } from './AIFlow';
export { ContactForm } from './ContactForm';
export { Footer } from './Footer';
```

- [ ] **Step 3: Add color tokens to globals.css**

Open `src/app/globals.css`. After the existing `:root { ... }` block (ends around line 27), add a new block:

```css
:root {
  --bg-void: #060d1f;
  --bg-deep-navy: #040a18;
  --teal-400: #2dd4bf;
  --cyan-300: #67e8f9;
  --text-100: #e5e7eb;
  --text-200: #d1d5db;
  --text-300: #9ca3af;
  --text-400: #6b7280;
}
```

Then at the bottom of the file, add the focus-visible ring token and the global reduced-motion rule:

```css
/* v5.6 landing — focus-visible ring (v5.5 a11y pass) */
.landing-page :focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg-void), 0 0 0 4px var(--teal-400);
  border-radius: 4px;
}

/* v5.6 landing — global reduced motion */
@media (prefers-reduced-motion: reduce) {
  .landing-page *,
  .landing-page *::before,
  .landing-page *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

Do NOT touch the existing `.blob-*`, `.partner-scroll-track`, `.hero-badge-glow` classes — they're still being used by the live `page.tsx` until Task 13.

- [ ] **Step 4: Type-check**

```bash
cd /c/Users/John/crypto-treasury/.worktrees/landing-refresh
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Visual smoke**

```bash
npm run dev
```

Browse to `http://localhost:3000`. The current landing page should render exactly as before (we haven't touched `page.tsx`). The new stub components are dead code at this point — they exist but nothing imports them yet.

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/ src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(landing): scaffold landing/ components and v5.6 color tokens

Adds empty stub components for the v5.6 landing refresh under
src/components/landing/, plus the locked color tokens, focus-visible
ring, and global prefers-reduced-motion rule in globals.css. The live
page.tsx is untouched — every subsequent task fills in one stub.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Navbar — extract verbatim, add mobile sheet

**Goal:** Move the Navbar function out of `page.tsx` into `Navbar.tsx`, preserving the NextAuth sign-in dropdown verbatim. Add a proper full-screen mobile sheet (the current mobile menu collapses inline below the nav, which the spec rejects).

**Files:**
- Modify: `src/components/landing/Navbar.tsx` (replace stub)
- Reference: `src/app/page.tsx:341-573` (current Navbar, do NOT modify yet — Task 13 deletes it)

- [ ] **Step 1: Open the current Navbar and copy lines 341-573**

In `page.tsx`, the Navbar function starts at line 341 (`function Navbar() {`) and ends at line 573 (`}`). Copy that whole function body into clipboard.

- [ ] **Step 2: Replace Navbar.tsx with the extracted code**

Open `src/components/landing/Navbar.tsx` and replace the stub with:

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Menu, X, Loader2 } from 'lucide-react';

export function Navbar() {
  // ... paste the entire body from page.tsx:341-573 here ...
  // CHANGE: rename the function from `function Navbar()` to `export function Navbar()`
  // CHANGE: do not include the `function Navbar() {` line and closing `}` — just paste the body
}
```

The full pasted content is the Navbar function from `page.tsx:341-573` verbatim — do NOT alter the sign-in form, the `handleLogin` callback, the dropdown JSX, or the `loginRef` / `mobileLoginRef` refs. The only changes from the original are the imports (which now live at the top of `Navbar.tsx`) and the export keyword.

- [ ] **Step 3: Replace the inline mobile menu with a full-screen sheet**

Inside the Navbar JSX, find the `{mobileOpen && (` block (currently around line 509-570 in `page.tsx`). Replace its outer wrapper from:

```tsx
<div className="md:hidden bg-[#060d1f]/95 backdrop-blur-xl border-t border-white/5 px-6 pb-6 pt-2 space-y-4 animate-dropdown">
```

to a fixed-position full-screen sheet:

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-label="Navigation menu"
  className="lg:hidden fixed inset-0 z-[60] bg-[var(--bg-void)]/98 backdrop-blur-xl flex flex-col"
>
  <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
    <Image src="/logo-dark.png" alt="Vantor" width={140} height={44} className="object-contain" priority unoptimized />
    <button
      onClick={() => setMobileOpen(false)}
      aria-label="Close navigation menu"
      className="w-12 h-12 flex items-center justify-center text-gray-300 hover:text-white"
    >
      <X size={28} />
    </button>
  </div>
  <div className="flex-1 overflow-y-auto px-6 py-8 space-y-2">
    {navLinks.map((l) => (
      <a
        key={l.href}
        href={l.href}
        onClick={() => setMobileOpen(false)}
        className="block py-4 text-2xl font-medium text-gray-200 hover:text-white border-b border-white/[0.04]"
      >
        {l.label}
      </a>
    ))}
    <div className="pt-6">
      {/* keep the existing inline sign-in form here — copy the exact <form ref={mobileLoginRef}> block from page.tsx:529-567 verbatim, including the loginError display and submit button */}
    </div>
  </div>
</div>
```

The inner sign-in form is the existing `<form ref={mobileLoginRef}>` JSX from `page.tsx:529-567` — copy it verbatim. Do not add a separate "Login" button that toggles the form open; the form is always visible inside the sheet (the current behavior of "click Login first, then form appears" is the bit being removed).

Also change the hamburger button (currently `page.tsx:503-505`) from `md:hidden` to `lg:hidden` so the sheet shows up on tablets too:

```tsx
<button
  className="lg:hidden text-gray-400 w-12 h-12 flex items-center justify-center"
  onClick={() => setMobileOpen(!mobileOpen)}
  aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
  aria-expanded={mobileOpen}
>
  {mobileOpen ? <X size={24} /> : <Menu size={24} />}
</button>
```

And change the desktop links container from `hidden md:flex` to `hidden lg:flex` (currently line 419) so they only appear at desktop sizes.

- [ ] **Step 3.5: Update navLinks to match the new page structure**

The verbatim Navbar copy includes a `navLinks` array that points to `#features` and `#security` — those sections are deleted in Task 13 (replaced by `CapabilityGrid` with `id="platform"` and `TrustBand` with no id). Replace the array inside `Navbar.tsx` with:

```tsx
const navLinks = [
  { label: 'Platform', href: '#platform' },
  { label: 'AI Agent', href: '#agent' },
  { label: 'Contact', href: '#contact' },
];
```

Three links instead of four. The TrustBand intentionally has no anchor — it's a footnote section, not a destination.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. The new `Navbar.tsx` is not yet imported by `page.tsx` so there are no usage errors to worry about.

- [ ] **Step 5: Temporarily mount the new Navbar to verify it renders**

This is a one-line throwaway change to confirm the extracted Navbar works before we commit. In `page.tsx`, at the top of the imports, add:

```tsx
import { Navbar as NewNavbar } from '@/components/landing/Navbar';
```

Then in the `LandingPage` component (line ~1108), replace `<Navbar />` with `<NewNavbar />`.

- [ ] **Step 6: Visual smoke**

`npm run dev` is already running from Task 1. Refresh `http://localhost:3000`. Verify:
- Logo renders, nav links visible at lg+ widths
- Login dropdown opens, accepts credentials, redirects to `/dashboard` (test with a real seeded user)
- Resize to 800px wide — desktop links disappear, hamburger appears
- Tap hamburger — full-screen sheet opens with logo, close button, stacked nav links, and the inline sign-in form
- Tap close — sheet closes
- Tap a nav link inside the sheet — sheet closes and page scrolls to anchor

- [ ] **Step 7: Revert the temporary mount**

In `page.tsx`, remove the `import { Navbar as NewNavbar }` line and change `<NewNavbar />` back to `<Navbar />`. We're done verifying — the old inline `Navbar` function inside `page.tsx` keeps the live page working until Task 13.

- [ ] **Step 8: Type-check again**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/landing/Navbar.tsx
git commit -m "$(cat <<'EOF'
feat(landing): extract Navbar with full-screen mobile sheet

Pulls Navbar out of page.tsx into src/components/landing/Navbar.tsx,
preserving the NextAuth sign-in dropdown verbatim. Replaces the inline
mobile menu with a full-screen sheet that surfaces the sign-in form
inline (no extra "click Login first" step). Hamburger now activates at
lg: instead of md: so tablets get the sheet too.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: NetworkCanvas + BlobBackground — extract with density props

**Goal:** Move `NetworkCanvas` and `BlobBackground` out of `page.tsx` into their own files and add density/blur props so the hero can pass smaller values on mobile per spec §7.5.

**Files:**
- Modify: `src/components/landing/NetworkCanvas.tsx` (replace stub)
- Modify: `src/components/landing/BlobBackground.tsx` (replace stub)
- Reference: `src/app/page.tsx:65-323` (NetworkCanvas) and `:328-336` (BlobBackground)

- [ ] **Step 1: Replace NetworkCanvas.tsx**

Copy the `NetworkCanvas` function from `page.tsx:65-323` verbatim into `src/components/landing/NetworkCanvas.tsx`, plus the three interface definitions (`Node`, `Edge`, `Particle`) from lines 54-63.

Add a `particleCount` prop that defaults to 50 and replaces the hard-coded `50` in the particle spawn loop (currently line 119: `for (let p = 0; p < 50; p++) {`).

```tsx
'use client';

import { useEffect, useRef, useCallback } from 'react';

interface Node {
  x: number; y: number; vx: number; vy: number;
  radius: number; label: string; pulse: number;
}
interface Edge {
  i: number; j: number; dist: number;
}
interface Particle {
  edgeIdx: number; t: number; speed: number; dir: 1 | -1;
}

export function NetworkCanvas({ particleCount = 50 }: { particleCount?: number }) {
  // ... paste the body of the existing NetworkCanvas function verbatim ...
  // CHANGE 1: in initNodes, replace `for (let p = 0; p < 50; p++) {`
  //           with `for (let p = 0; p < particleCount; p++) {`
  // CHANGE 2: add `particleCount` to the initNodes useCallback deps array:
  //           `}, [particleCount]);`
}
```

Also disable the canvas entirely if `prefers-reduced-motion: reduce` is set. At the top of the `useEffect`, add:

```tsx
useEffect(() => {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return; // skip the entire animation setup
  }
  const canvas = canvasRef.current;
  // ... rest of existing useEffect body ...
}, [initNodes]);
```

- [ ] **Step 2: Replace BlobBackground.tsx**

The current `BlobBackground` (page.tsx:328-336) renders 3 divs styled by `.blob-*` CSS classes. Move the styling inline so we can pass a `blurRadius` prop and so Task 13 can purge the dead CSS without breaking anything.

```tsx
'use client';

export function BlobBackground({ blurRadius = 100 }: { blurRadius?: number }) {
  const blobBase: React.CSSProperties = {
    position: 'absolute',
    borderRadius: '50%',
    filter: `blur(${blurRadius}px)`,
    opacity: 0.4,
    willChange: 'transform',
  };
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        style={{
          ...blobBase,
          width: 600,
          height: 600,
          top: '-10%',
          left: '-10%',
          background: 'radial-gradient(circle, rgba(45,212,191,0.18) 0%, transparent 70%)',
          animation: 'blobFloat1 18s ease-in-out infinite',
        }}
      />
      <div
        style={{
          ...blobBase,
          width: 500,
          height: 500,
          top: '20%',
          right: '-8%',
          background: 'radial-gradient(circle, rgba(34,211,238,0.12) 0%, transparent 70%)',
          animation: 'blobFloat2 22s ease-in-out infinite',
        }}
      />
      <div
        style={{
          ...blobBase,
          width: 400,
          height: 400,
          bottom: '-5%',
          left: '30%',
          background: 'radial-gradient(circle, rgba(45,212,191,0.10) 0%, transparent 70%)',
          animation: 'blobFloat3 20s ease-in-out infinite',
        }}
      />
    </div>
  );
}
```

The `blobFloat1/2/3` keyframes still live in `globals.css` for now — Task 13 inlines them into a `<style jsx>` block or moves them to a dedicated landing CSS file. For now, the inline styles reference the existing keyframe names so nothing breaks.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/NetworkCanvas.tsx src/components/landing/BlobBackground.tsx
git commit -m "$(cat <<'EOF'
feat(landing): extract NetworkCanvas and BlobBackground with density props

Moves both components into src/components/landing/ with prop-based
density controls (particleCount on NetworkCanvas, blurRadius on
BlobBackground) so HeroBackdrop can dial them down on mobile per spec
section 7.5. NetworkCanvas now early-returns if prefers-reduced-motion
is set. BlobBackground styles are inlined; the .blob-* CSS classes will
be purged in Task 13.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: HeroBackdrop + Hero

**Goal:** Build the new `Hero` component with the locked v5.6 copy (no metric pills, no scroll indicator) and a `HeroBackdrop` wrapper that composes `NetworkCanvas` + `BlobBackground` and reads the viewport size on mount to pick density values.

**Files:**
- Modify: `src/components/landing/HeroBackdrop.tsx` (replace stub)
- Modify: `src/components/landing/Hero.tsx` (replace stub)

- [ ] **Step 1: Replace HeroBackdrop.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { NetworkCanvas } from './NetworkCanvas';
import { BlobBackground } from './BlobBackground';

export function HeroBackdrop() {
  const [density, setDensity] = useState({ particles: 80, blur: 120 });

  useEffect(() => {
    const w = window.innerWidth;
    if (w < 768) setDensity({ particles: 30, blur: 60 });
    else if (w < 1280) setDensity({ particles: 60, blur: 100 });
    else setDensity({ particles: 80, blur: 120 });
  }, []);

  return (
    <>
      <BlobBackground blurRadius={density.blur} />
      <NetworkCanvas particleCount={density.particles} />
      <div
        className="absolute inset-0 z-[5] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 50% 40% at 50% 50%, rgba(6,13,31,0.25) 0%, rgba(6,13,31,0) 100%)',
        }}
        aria-hidden
      />
    </>
  );
}
```

This reads `window.innerWidth` once on mount. The spec explicitly rejects `navigator.deviceMemory` gating; viewport-based density is the only signal we use.

- [ ] **Step 2: Replace Hero.tsx**

```tsx
'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HeroBackdrop } from './HeroBackdrop';

export function Hero() {
  return (
    <section className="relative flex items-center justify-center overflow-hidden min-h-screen pt-32 pb-20 lg:pt-40 lg:pb-32 bg-[var(--bg-void)]">
      <HeroBackdrop />

      <div className="relative z-10 max-w-5xl mx-auto text-center px-6">
        <h1
          className="font-bold tracking-tight leading-[1.08] landing-fade-in landing-delay-1 text-white"
          style={{ fontSize: 'clamp(2.25rem, 1.5rem + 3.5vw, 4rem)', letterSpacing: '-0.028em' }}
        >
          Put Your Idle Treasury
          <br />
          <span className="bg-gradient-to-r from-teal-400 via-cyan-300 to-teal-400 bg-clip-text text-transparent">
            Reserves to Work
          </span>
        </h1>

        <p className="mt-6 text-base sm:text-lg lg:text-xl text-[var(--text-300)] max-w-2xl mx-auto leading-relaxed landing-fade-in landing-delay-2">
          Vantor provides full visibility across your cash and stablecoin reserves. Powerful AI insights assess upcoming obligations while surfacing yield opportunities and hedging FX exposure — always with a human in the loop.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 landing-fade-in landing-delay-3">
          <Link
            href="/register"
            className="group w-full sm:w-auto min-h-[48px] px-8 py-3.5 rounded-full text-base font-semibold bg-gradient-to-r from-teal-500 to-cyan-400 text-white hover:shadow-[0_0_32px_rgba(45,212,191,0.4)] transition-all duration-500 flex items-center justify-center"
          >
            Get Started Free
            <ArrowRight size={16} className="inline ml-2 group-hover:translate-x-1 transition-transform" />
          </Link>
          <a
            href="#platform"
            className="w-full sm:w-auto min-h-[48px] px-8 py-3.5 rounded-full text-base font-medium text-[var(--text-200)] border border-white/10 hover:border-white/25 hover:bg-white/5 transition-all duration-300 flex items-center justify-center"
          >
            Explore Platform
          </a>
        </div>
      </div>
    </section>
  );
}
```

Notes for the engineer:
- The `clamp()` on the h1 is per spec §7.4 — smooth scaling between 360px and 1280px instead of stepping at named breakpoints.
- CTAs are `w-full sm:w-auto` and `min-h-[48px]` so they're full-width and tappable on mobile.
- `href="#platform"` on Explore Platform points to the capability grid (Task 5 sets `id="platform"` on it). NOT the AI flow.
- The h1 has only ONE br tag — the second line `Reserves to Work` flows naturally below.
- No floating metric pills, no scroll indicator chevron — both vetoed.

- [ ] **Step 3: Temporarily mount Hero to verify**

In `page.tsx`, add at the top of imports:

```tsx
import { Hero as NewHero } from '@/components/landing/Hero';
```

Inside the `LandingPage` return, replace `<Hero />` (around line 1113) with `<NewHero />`.

- [ ] **Step 4: Visual smoke**

Refresh `http://localhost:3000`. Verify:
- Headline renders, line 2 is gradient teal→cyan
- Sub-pitch matches the locked copy exactly
- Two CTAs, gradient pill + outline
- Mesh canvas + blob backdrop visible behind hero
- No floating metric pills, no scroll-down chevron
- At 360px width: headline is ~36px, CTAs stack vertically full-width, no horizontal scroll
- Inspect NetworkCanvas in DevTools: at 360px the particle count should be 30 (you can verify by checking for ~30 dots flowing along edges)
- Toggle "Emulate prefers-reduced-motion" in DevTools rendering panel: NetworkCanvas should disappear, blob keeps animating but the global rule will damp its animation duration

- [ ] **Step 5: Revert the temporary mount**

In `page.tsx`, remove the `import { Hero as NewHero }` line and change `<NewHero />` back to `<Hero />`.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/landing/HeroBackdrop.tsx src/components/landing/Hero.tsx
git commit -m "$(cat <<'EOF'
feat(landing): build Hero with HeroBackdrop and v5.6 locked copy

Hero ships with the locked headline, sub-pitch, and 2 CTAs from the
spec — no metric pills, no scroll chevron, no eyebrow label.
HeroBackdrop reads viewport once on mount and passes density props to
NetworkCanvas (30/60/80 particles by viewport tier) and BlobBackground
(60px/100px/120px blur). Headline uses clamp() per spec section 7.4.
CTAs are full-width with 48px min-height on mobile.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CapabilityGrid

**Goal:** Build the 6-card capability grid with the locked copy (no "Vantor" prefix), pure void background, 3×2 → 2×3 → 1col responsive grid.

**Files:**
- Modify: `src/components/landing/CapabilityGrid.tsx` (replace stub)

- [ ] **Step 1: Replace CapabilityGrid.tsx**

```tsx
'use client';

import { LayoutDashboard, Coins, TrendingUp, Shield, Plug, BarChart3 } from 'lucide-react';

const CAPABILITIES = [
  {
    icon: LayoutDashboard,
    title: 'Command Center',
    bullets: ['Cash Visibility', 'AI Insights', 'Asset Management', 'AI Agent Chat'],
  },
  {
    icon: Coins,
    title: 'Treasury',
    bullets: ['AI Treasury Rules', 'Payments Operations', 'Approval Workflows', 'FX Rebalancing'],
  },
  {
    icon: TrendingUp,
    title: 'Yield',
    bullets: ['Tokenized MMFs', 'DeFi Yield Protocols', 'AI Risk Management', 'AI Yield Insights'],
  },
  {
    icon: Shield,
    title: 'Compliance',
    bullets: ['Sanctions Screening', 'Transaction Monitoring', 'Know Your Transaction', 'Travel Rule Enforcement'],
  },
  {
    icon: Plug,
    title: 'Connect',
    bullets: ['Bank Integrations', 'Wallet Integrations', 'ERP Integrations', 'Slack Connector'],
  },
  {
    icon: BarChart3,
    title: 'Data',
    bullets: ['AI Forecasting', 'Advanced Analytics', 'Audit Trail', 'Detailed Reporting'],
  },
];

export function CapabilityGrid() {
  return (
    <section
      id="platform"
      className="relative py-24 lg:py-32 bg-[var(--bg-void)] scroll-mt-20"
    >
      <div className="max-w-7xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-16 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Modern treasury management — powered by AI
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {CAPABILITIES.map((c) => (
            <div
              key={c.title}
              className="group relative p-7 rounded-xl bg-white/[0.025] border border-white/[0.06] hover:border-white/[0.12] transition-colors duration-300 min-h-[220px]"
            >
              <div className="w-11 h-11 rounded-lg bg-[var(--teal-400)]/10 flex items-center justify-center mb-5">
                <c.icon size={22} className="text-[var(--teal-400)]" />
              </div>
              <h3
                className="text-lg lg:text-xl font-semibold text-white mb-4"
                style={{ letterSpacing: '-0.012em' }}
              >
                {c.title}
              </h3>
              <ul className="space-y-2">
                {c.bullets.map((b) => (
                  <li key={b} className="text-sm lg:text-base text-[var(--text-300)] flex items-start gap-2">
                    <span className="text-[var(--teal-400)] mt-0.5">·</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

Notes:
- `id="platform"` is the anchor target for the hero "Explore Platform" CTA.
- Pure void background — no blob, no canvas, no gradient. This is the deliberate flat beat.
- Hover is `border-color` only — no lift, no scale, no bounce (spec §6.5).
- Card min-height keeps the grid rhythm consistent across cards.
- Bullet text size steps from `text-sm` (mobile) to `text-base` (lg+) per spec §7.2.

- [ ] **Step 2: Temporarily mount CapabilityGrid to verify**

In `page.tsx`, add:

```tsx
import { CapabilityGrid as NewGrid } from '@/components/landing/CapabilityGrid';
```

Inside `LandingPage`, after `<PartnerScroll />` (line ~1115), add `<NewGrid />`.

- [ ] **Step 3: Visual smoke**

Refresh. Scroll past the existing partner scroll and verify the new grid renders:
- 6 cards in a 3×2 layout at 1440px
- 2×3 at 800px
- 1 column stacked at 360px
- Card hover changes only the border color
- All bullets render with the teal `·` marker
- Verify `Command Center` does NOT have a "Vantor " prefix
- Verify `Yield` 4th bullet is `AI Yield Insights` (not `Slippage Protection` or `Automated Yield Strategies`)
- Click "Explore Platform" in the hero — should scroll to the grid

- [ ] **Step 4: Revert the temporary mount**

Remove the `import { CapabilityGrid as NewGrid }` line and remove `<NewGrid />` from the JSX.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/CapabilityGrid.tsx
git commit -m "$(cat <<'EOF'
feat(landing): build CapabilityGrid with 6 locked cards

Six-card capability grid (3x2 -> 2x3 -> 1col), pure void background,
hairline borders with hover-only border-color shift. Card copy is
locked from spec section 5 — no "Vantor" prefix, Yield uses
"AI Yield Insights" as the 4th bullet. Section id="platform" is the
anchor target for the hero Explore Platform CTA.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: TrustBand

**Goal:** Build the 6-pillar trust band with the locked copy including the new Enterprise-Grade Security pillar, narrow `max-w-4xl` container for the asymmetric "footnote" beat per spec §6.5.

**Files:**
- Modify: `src/components/landing/TrustBand.tsx` (replace stub)

- [ ] **Step 1: Replace TrustBand.tsx**

```tsx
'use client';

import { AlertTriangle, Eye, ClipboardCheck, Users, Lock, ShieldCheck } from 'lucide-react';

const PILLARS = [
  {
    icon: AlertTriangle,
    title: 'AML & Sanctions Screening',
    desc: 'Automated anti-money laundering checks and real-time sanctions screening against OFAC, EU, and UN lists on every transaction.',
  },
  {
    icon: Eye,
    title: 'Transaction Monitoring',
    desc: 'Continuous monitoring of all on-chain and off-chain transactions. Pattern detection, velocity checks, and anomalous behavior alerting.',
  },
  {
    icon: ClipboardCheck,
    title: 'Audit Logging & Explainability',
    desc: 'Immutable audit trail for every action — human and AI. Full decision provenance so you can explain exactly why any action was taken.',
  },
  {
    icon: Users,
    title: 'Role-Based Permissions',
    desc: 'Granular RBAC with treasury manager, analyst, viewer, and admin roles. Enforce least-privilege access across your entire organization.',
  },
  {
    icon: Lock,
    title: 'Approval Workflows',
    desc: 'Configurable multi-level approval chains. High-value transactions require multiple authorized signers before execution.',
  },
  {
    icon: ShieldCheck,
    title: 'Enterprise-Grade Security',
    desc: 'End-to-end encryption, hardened infrastructure, and continuous monitoring — the security posture enterprise treasury teams expect.',
  },
];

export function TrustBand() {
  return (
    <section className="relative py-24 lg:py-32 bg-[var(--bg-void)]">
      <div className="max-w-4xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl font-semibold text-white text-center mb-12 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Built for institutions
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="p-6 rounded-xl bg-white/[0.025] border border-white/[0.06] hover:border-white/[0.12] transition-colors duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-[var(--teal-400)]/10 flex items-center justify-center mb-4">
                <p.icon size={20} className="text-[var(--teal-400)]" />
              </div>
              <h3 className="text-base font-semibold text-white mb-2" style={{ letterSpacing: '-0.01em' }}>
                {p.title}
              </h3>
              <p className="text-sm text-[var(--text-300)] leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

Notes:
- `max-w-4xl` is intentionally narrower than the 7xl used elsewhere — this is the "footnote beat" asymmetry from spec §6.5.
- Section title `Built for institutions` is the new title (the old `Institutional-Grade from Day One` wording is dropped per spec §5 eyebrow removal).
- The 6th pillar uses `ShieldCheck` (lucide icon) — distinct from `Shield` used by Compliance in CapabilityGrid.

- [ ] **Step 2: Temporarily mount TrustBand to verify**

```tsx
import { TrustBand as NewTrust } from '@/components/landing/TrustBand';
```

Add `<NewTrust />` after `<NewGrid />` placeholder if you have one, or anywhere after `<PartnerScroll />` in `LandingPage`.

- [ ] **Step 3: Visual smoke**

Refresh. Verify:
- 6 cards including Enterprise-Grade Security
- Container is narrower than the capability grid above (~896px vs 1280px) — should be visually obvious
- Cards stack 1 col → 2×3 → 3×2 as you resize
- All copy matches the locked text exactly

- [ ] **Step 4: Revert the temporary mount**

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/TrustBand.tsx
git commit -m "$(cat <<'EOF'
feat(landing): build TrustBand with 6 pillars in narrow max-w-4xl

Trust band ships with the 5 existing pillars from the old Security
section plus the new Enterprise-Grade Security 6th pillar. Container
is max-w-4xl (intentionally narrower than the 7xl rhythm) for the
footnote-asymmetric beat per spec section 6.5. Section title is
"Built for institutions" — eyebrow labels are dead.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: FeatureCarousel

**Goal:** Build the 3-slide feature carousel with dot navigation, touch swipe, and no autoplay. Use styled CSS/SVG mockups for slide screenshots (real PNGs are out of scope per spec §10).

**Files:**
- Modify: `src/components/landing/FeatureCarousel.tsx` (replace stub)

- [ ] **Step 1: Replace FeatureCarousel.tsx**

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const SLIDES = [
  {
    eyebrow: 'COMMAND CENTER',
    title: 'Every account, every chain, one view',
    body: 'Bank balances, wallet positions, yield deployments, and pending obligations rendered as a single live treasury picture. Drill into any line for full transaction history.',
    mockClass: 'mock-command-center',
  },
  {
    eyebrow: 'TREASURY',
    title: 'AI-drafted moves, human-approved',
    body: 'Vantor watches your balances and obligations and queues recommended moves with full reasoning. You approve, edit, or reject — nothing executes without a human in the loop.',
    mockClass: 'mock-treasury',
  },
  {
    eyebrow: 'YIELD',
    title: 'Tokenized MMFs and on-chain protocols, side by side',
    body: 'Compare Spiko USD, Circle USYC, Aave, Morpho and more on a single rate board. Slippage estimates, risk scores, and one-click deposit flows — no DeFi expertise required.',
    mockClass: 'mock-yield',
  },
];

export function FeatureCarousel() {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const goto = (i: number) => setActive(((i % SLIDES.length) + SLIDES.length) % SLIDES.length);
  const next = () => goto(active + 1);
  const prev = () => goto(active - 1);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };
  const onTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    const dx = touchEndX.current - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) next();
      else prev();
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  return (
    <section className="relative py-24 lg:py-32" style={{ background: 'var(--bg-deep-navy)' }}>
      <div className="max-w-7xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-16 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          See it in action
        </h2>

        <div
          ref={trackRef}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="relative"
        >
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Text column */}
            <div key={`text-${active}`} className="landing-fade-in">
              <p className="text-xs font-medium text-[var(--teal-400)] tracking-[0.12em] uppercase mb-3">
                {SLIDES[active].eyebrow}
              </p>
              <h3
                className="text-2xl lg:text-3xl font-semibold text-white mb-4 leading-tight"
                style={{ letterSpacing: '-0.015em' }}
              >
                {SLIDES[active].title}
              </h3>
              <p className="text-base text-[var(--text-300)] leading-relaxed">{SLIDES[active].body}</p>
            </div>

            {/* Mockup frame */}
            <div className="relative">
              <div
                className="absolute inset-0 rounded-2xl"
                style={{
                  background:
                    'radial-gradient(ellipse at center, rgba(45,212,191,0.12) 0%, transparent 70%)',
                  filter: 'blur(40px)',
                }}
                aria-hidden
              />
              <div
                className="relative rounded-xl border border-white/[0.08] bg-white/[0.02] aspect-[16/10] flex items-center justify-center text-[var(--text-400)] text-sm overflow-hidden"
                style={{
                  boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
              >
                {/* v1 mockup placeholder — real PNGs are a follow-up per spec section 10 */}
                <div className={`w-full h-full ${SLIDES[active].mockClass}`}>
                  <div className="p-6 text-xs text-[var(--text-300)]">
                    [{SLIDES[active].eyebrow} mockup placeholder]
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Slide arrows — visible at lg+ only */}
          <button
            onClick={prev}
            aria-label="Previous slide"
            className="hidden lg:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 w-12 h-12 items-center justify-center rounded-full border border-white/10 text-[var(--text-200)] hover:border-white/25 hover:text-white transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={next}
            aria-label="Next slide"
            className="hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 w-12 h-12 items-center justify-center rounded-full border border-white/10 text-[var(--text-200)] hover:border-white/25 hover:text-white transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Dot nav — visible at all viewports, 24x24 hit area, 8x8 visible dot */}
        <div className="flex items-center justify-center gap-3 mt-12">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => goto(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === active ? 'true' : undefined}
              className="w-6 h-6 flex items-center justify-center group"
            >
              <span
                className={`block w-2 h-2 rounded-full transition-colors ${
                  i === active ? 'bg-[var(--teal-400)]' : 'bg-white/20 group-hover:bg-white/40'
                }`}
              />
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-[var(--text-300)] mt-4">
          {active + 1} / {SLIDES.length}
        </p>
      </div>
    </section>
  );
}
```

Notes:
- Dot buttons are 24×24 with an 8×8 visible dot inside — touch target ≥ visible affordance per spec §7.2.
- Slide counter `1 / 3` uses `--text-300` (`#9ca3af`) per the v5.5 a11y pass.
- Touch swipe is ~30 lines of vanilla — no library.
- Mockup placeholders are intentional. Real screenshots are a follow-up per spec §10. The radial teal glow behind the frame is a CSS gradient.

- [ ] **Step 2: Temporarily mount FeatureCarousel to verify**

```tsx
import { FeatureCarousel as NewCarousel } from '@/components/landing/FeatureCarousel';
```

Add `<NewCarousel />` somewhere after the existing PartnerScroll in `LandingPage`.

- [ ] **Step 3: Visual smoke**

Refresh. Verify:
- 3 slides, default to slide 1
- Dot nav switches slides on click
- Click forward/back arrows at desktop width — slide changes
- Resize to 800px — arrows disappear, dot nav stays
- DevTools touch emulation: swipe left on the carousel — slide advances
- No autoplay (sit on the page for 30s, slide should not change on its own)

- [ ] **Step 4: Revert the temporary mount**

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/FeatureCarousel.tsx
git commit -m "$(cat <<'EOF'
feat(landing): build FeatureCarousel with 3 slides and touch swipe

Three-slide carousel (Command Center / Treasury / Yield) on the
deep-navy zoom-in background. Dot nav at all viewports with 24x24
touch targets, slide arrows visible at lg+, vanilla touchstart/end
swipe with 50px threshold. No autoplay. Mockup frames are CSS
placeholders for v1 — real screenshots are a follow-up per spec
section 10.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: InsightFeed

**Goal:** Build the 5-card insight feed with rotation logic — the second beat of the AI Flow section. 3 cards visible at desktop, 1 at mobile, 5s cadence, pause on hover/focus, `aria-live="polite"`.

**Files:**
- Modify: `src/components/landing/InsightFeed.tsx` (replace stub)

- [ ] **Step 1: Replace InsightFeed.tsx**

```tsx
'use client';

import { useEffect, useState, useRef } from 'react';

const INSIGHTS = [
  '$2.3M idle USDC → Spiko USD · +4.9% APY',
  '€1.8M payroll due → convert USD to EUR',
  '$500K vendor payment → withdraw Circle USYC',
  '$4.5M outbound wire → manager approval required',
  '$1.2M Spiko USD · 4.9% → Circle USYC · +5.1% APY',
];

const ROTATION_MS = 5000;

export function InsightFeed() {
  const [head, setHead] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const id = window.setInterval(() => {
      setHead((h) => (h + 1) % INSIGHTS.length);
    }, ROTATION_MS);
    return () => window.clearInterval(id);
  }, [paused, reducedMotion]);

  // Show 3 cards starting at `head`, wrapping around
  const visible = [0, 1, 2].map((i) => INSIGHTS[(head + i) % INSIGHTS.length]);

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-live="polite"
      aria-atomic="true"
      className="w-full max-w-3xl mx-auto"
    >
      {/* Mobile: show 1 card. sm: show 2. lg: show 3. Cards beyond the cap are hidden. */}
      <div className="space-y-3">
        {visible.map((text, i) => {
          const opacity = i === 0 ? 1 : i === 1 ? 0.85 : 0.6;
          const visibilityClass =
            i === 0 ? '' : i === 1 ? 'hidden sm:block' : 'hidden lg:block';
          return (
            <div
              key={`${head}-${i}`}
              style={{ opacity }}
              className={`${visibilityClass} flex items-center justify-between gap-4 px-5 py-4 rounded-xl border border-white/[0.08] bg-white/[0.025] transition-opacity duration-500`}
            >
              <span className="text-sm sm:text-base text-[var(--text-100)] flex-1 min-w-0">
                {text}
              </span>
              <button
                type="button"
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border border-[var(--teal-400)]/40 text-[var(--teal-400)] hover:bg-[var(--teal-400)]/10 transition-colors min-h-[32px]"
              >
                Approve?
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Notes:
- All 5 insights use the SAME teal `Approve?` pill — do NOT vary the styling per insight (spec §"Insight feed").
- Rotation is 5s cadence, full loop is 25s (5 cards × 5s).
- Pause-on-hover does nothing on touch — also pause on `:focus` so keyboard users can read.
- `aria-live="polite"` so screen readers announce rotations without hijacking focus.
- `prefers-reduced-motion` stops rotation entirely; the feed becomes static showing the first 3 cards.
- Mobile shows 1 card, sm shows 2, lg shows 3 — implemented with `hidden sm:block` / `hidden lg:block`.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Temporarily mount on a test route**

We can't easily preview InsightFeed by itself in `page.tsx` without breaking the live page. Instead, render it inside a temporary `<div className="fixed bottom-4 right-4 z-[100] w-96 p-4 bg-black/80 rounded">` block at the top of `LandingPage`'s return — just for visual smoke.

```tsx
import { InsightFeed as TempFeed } from '@/components/landing/InsightFeed';
// ...inside LandingPage's return, right after the opening <div>:
<div className="fixed bottom-4 right-4 z-[100] w-96 p-4 bg-black/80 rounded-2xl">
  <TempFeed />
</div>
```

- [ ] **Step 4: Visual smoke**

Refresh. In the bottom-right corner you should see:
- 3 cards stacked, opacities 1.0 / 0.85 / 0.6 (top to bottom)
- Cards rotate every 5 seconds, the top card slides off and a new one appears at the bottom
- Hover the feed — rotation stops
- Move mouse away — rotation resumes
- Resize browser to 600px — only 2 cards visible
- Resize to 360px — only 1 card visible
- Toggle DevTools "Emulate prefers-reduced-motion" — feed freezes
- Tab into the feed with keyboard — rotation pauses on focus

- [ ] **Step 5: Revert the temporary mount**

Remove the `import { InsightFeed as TempFeed }` line and the fixed-position wrapper div.

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/InsightFeed.tsx
git commit -m "$(cat <<'EOF'
feat(landing): build InsightFeed with 5-card rotation and a11y

Rotates the 5 locked insight strings on a 5s cadence, 25s full loop.
Shows 3 cards at lg+, 2 at sm, 1 at base. Opacities 1.0/0.85/0.6 per
spec. Pauses on hover and focus-within. aria-live="polite" so screen
readers announce rotations without hijacking focus.
prefers-reduced-motion freezes the feed entirely. All 5 insights use
the same teal Approve? pill — styling does not vary per insight.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: AIFlowDiagram — desktop SVG offset-path + mobile beam fallback

**Goal:** Build the diagram that's the headline beat of the page. Desktop is the full SVG offset-path treatment with multiple particles per path and an orb pulse. Mobile (`< lg:`) is a deliberately simpler beam-and-orb layout per spec §7.2.

**Files:**
- Modify: `src/components/landing/AIFlowDiagram.tsx` (replace stub)

This is the highest-risk task in the plan. If the SVG offset-path treatment turns out harder than expected, the mobile fallback alone is enough to communicate the idea — see the §10 escape hatch in the spec.

- [ ] **Step 1: Replace AIFlowDiagram.tsx — desktop layout first**

```tsx
'use client';

const INPUTS = ['Upcoming AR/AP', 'Cash · Banks + Wallets', 'Treasury Policy', 'FX Exposure'];
const OUTPUTS = ['Spiko USD', 'Circle USYC', 'FX Rebalance', 'Payments'];

export function AIFlowDiagram() {
  return (
    <div className="relative">
      {/* Desktop layout — visible at lg+ */}
      <div className="hidden lg:block">
        <DesktopDiagram />
      </div>
      {/* Mobile fallback — visible below lg */}
      <div className="lg:hidden">
        <MobileDiagram />
      </div>
    </div>
  );
}

function DesktopDiagram() {
  // SVG dimensions
  const W = 900;
  const H = 480;
  const orbX = W / 2;
  const orbY = H / 2;
  const inputX = 80;
  const outputX = W - 80;
  const chipYs = [80, 180, 280, 380];

  // Build a path from each input chip to the orb, and from the orb to each output chip.
  // Use a quadratic curve so the particle motion looks like flow, not a straight line.
  const inputPaths = chipYs.map(
    (y) => `M ${inputX + 90} ${y} Q ${(inputX + orbX) / 2} ${(y + orbY) / 2 - 20}, ${orbX - 50} ${orbY}`
  );
  const outputPaths = chipYs.map(
    (y) => `M ${orbX + 50} ${orbY} Q ${(orbX + outputX) / 2} ${(orbY + y) / 2 + 20}, ${outputX - 90} ${y}`
  );

  return (
    <div className="relative w-full max-w-[900px] mx-auto" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        {/* Paths */}
        {inputPaths.map((d, i) => (
          <path key={`in-${i}`} id={`in-path-${i}`} d={d} fill="none" stroke="rgba(45,212,191,0.15)" strokeWidth="1" />
        ))}
        {outputPaths.map((d, i) => (
          <path key={`out-${i}`} id={`out-path-${i}`} d={d} fill="none" stroke="rgba(45,212,191,0.15)" strokeWidth="1" />
        ))}

        {/* Particles — 2 per path, staggered */}
        {inputPaths.map((d, i) => (
          <g key={`in-particles-${i}`}>
            <circle r="3" fill="#2dd4bf">
              <animateMotion dur="2s" repeatCount="indefinite" begin={`${i * 0.3}s`} path={d} />
            </circle>
            <circle r="2" fill="#67e8f9" opacity="0.7">
              <animateMotion dur="2s" repeatCount="indefinite" begin={`${i * 0.3 + 1}s`} path={d} />
            </circle>
          </g>
        ))}
        {outputPaths.map((d, i) => (
          <g key={`out-particles-${i}`}>
            <circle r="3" fill="#2dd4bf">
              <animateMotion dur="2s" repeatCount="indefinite" begin={`${i * 0.3 + 0.5}s`} path={d} />
            </circle>
            <circle r="2" fill="#67e8f9" opacity="0.7">
              <animateMotion dur="2s" repeatCount="indefinite" begin={`${i * 0.3 + 1.5}s`} path={d} />
            </circle>
          </g>
        ))}

        {/* Central orb */}
        <g>
          <circle cx={orbX} cy={orbY} r="50" fill="rgba(45,212,191,0.08)" stroke="rgba(45,212,191,0.4)" strokeWidth="1.5">
            <animate attributeName="r" values="48;52;48" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.6;1;0.6" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle cx={orbX} cy={orbY} r="30" fill="rgba(45,212,191,0.15)" />
          <text
            x={orbX}
            y={orbY + 5}
            textAnchor="middle"
            fontSize="14"
            fontWeight="600"
            fill="#e5e7eb"
            style={{ letterSpacing: '-0.01em' }}
          >
            Vantor AI
          </text>
        </g>
      </svg>

      {/* Input chips (positioned absolutely on top of the SVG) */}
      <div className="absolute inset-0">
        {INPUTS.map((label, i) => (
          <div
            key={label}
            className="absolute px-4 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-[var(--text-200)] whitespace-nowrap"
            style={{
              left: `${(inputX / W) * 100}%`,
              top: `${(chipYs[i] / H) * 100}%`,
              transform: 'translate(0, -50%)',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Output chips */}
      <div className="absolute inset-0">
        {OUTPUTS.map((label, i) => (
          <div
            key={label}
            className="absolute px-4 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-[var(--text-200)] whitespace-nowrap"
            style={{
              left: `${(outputX / W) * 100}%`,
              top: `${(chipYs[i] / H) * 100}%`,
              transform: 'translate(-100%, -50%)',
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileDiagram() {
  return (
    <div className="relative max-w-md mx-auto py-4">
      {/* Inputs 2x2 above */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {INPUTS.map((label) => (
          <div
            key={label}
            className="px-3 py-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-[var(--text-200)] text-center"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Beam above the orb */}
      <div className="relative h-12 flex items-center justify-center">
        <div
          className="absolute w-0.5 h-full"
          style={{
            background:
              'linear-gradient(to bottom, transparent, var(--teal-400), transparent)',
            animation: 'aiFlowBeam 2.4s ease-in-out infinite',
          }}
        />
      </div>

      {/* Orb */}
      <div className="flex items-center justify-center my-2">
        <div
          className="w-24 h-24 rounded-full border border-[var(--teal-400)]/40 bg-[var(--teal-400)]/8 flex items-center justify-center text-sm font-semibold text-[var(--text-100)]"
          style={{ animation: 'aiFlowOrbPulse 2.4s ease-in-out infinite' }}
        >
          Vantor AI
        </div>
      </div>

      {/* Beam below the orb */}
      <div className="relative h-12 flex items-center justify-center">
        <div
          className="absolute w-0.5 h-full"
          style={{
            background:
              'linear-gradient(to bottom, transparent, var(--teal-400), transparent)',
            animation: 'aiFlowBeam 2.4s ease-in-out infinite 1.2s',
          }}
        />
      </div>

      {/* Outputs 2x2 below */}
      <div className="grid grid-cols-2 gap-3 mt-6">
        {OUTPUTS.map((label) => (
          <div
            key={label}
            className="px-3 py-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-[var(--text-200)] text-center"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the mobile beam keyframes to globals.css**

At the bottom of `globals.css`, append:

```css
@keyframes aiFlowOrbPulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.3); }
  50%      { transform: scale(1.04); box-shadow: 0 0 0 12px rgba(45, 212, 191, 0); }
}
@keyframes aiFlowBeam {
  0%, 100% { opacity: 0.2; transform: scaleY(0.6); }
  50%      { opacity: 0.9; transform: scaleY(1); }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Temporarily mount the diagram**

```tsx
import { AIFlowDiagram as TempDiagram } from '@/components/landing/AIFlowDiagram';
// inside LandingPage, fixed bottom-right preview:
<div className="fixed bottom-4 right-4 z-[100] w-[1000px] max-w-[90vw] p-4 bg-black/80 rounded-2xl">
  <TempDiagram />
</div>
```

- [ ] **Step 5: Visual smoke at desktop**

Refresh at 1440px wide. Verify:
- 4 input chips on the left, 4 output chips on the right, central orb with `Vantor AI` label
- SVG curves visible faintly between each chip and the orb
- Particles flow from input chips → orb → output chips, 2 particles per path staggered
- Orb radius pulses subtly (2.4s loop)
- Toggle reduced-motion in DevTools — particles stop, orb stops pulsing

- [ ] **Step 6: Visual smoke at mobile**

Resize to 360px wide (or use DevTools device toolbar). Verify:
- Desktop SVG hidden, mobile fallback appears
- Inputs in 2×2 grid above the orb
- Orb centered with pulse animation
- Beam pulses above and below the orb (offset by 1.2s)
- Outputs in 2×2 grid below
- All 4 input labels and 4 output labels render correctly
- Toggle reduced-motion — orb stops pulsing, beams stop pulsing

- [ ] **Step 7: Revert the temporary mount**

- [ ] **Step 8: Commit**

```bash
git add src/components/landing/AIFlowDiagram.tsx src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(landing): build AIFlowDiagram with desktop SVG and mobile fallback

The headline beat of the page. Desktop (lg+) uses inline SVG with
animateMotion particles flowing along quadratic Bezier paths from 4
input chips through a pulsing central Vantor AI orb to 4 output chips.
Mobile (below lg) uses the deliberately simpler beam-and-orb fallback
per spec section 7.2 — inputs in a 2x2 above, pulsing orb, two beams,
outputs in a 2x2 below — same idea, no SVG path reflow. Both layouts
respect prefers-reduced-motion via the global rule from Task 1.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: AIFlow — section shell with title, diagram, feed, 4-step narrative

**Goal:** Build the AI Flow section shell that composes the diagram (Task 9), the insight feed (Task 8), and the 4-step narrative cards. This is the section title `Agentic intelligence, human control` plus the three rows beneath it.

**Files:**
- Modify: `src/components/landing/AIFlow.tsx` (replace stub)

- [ ] **Step 1: Replace AIFlow.tsx**

```tsx
'use client';

import { AIFlowDiagram } from './AIFlowDiagram';
import { InsightFeed } from './InsightFeed';

const STEPS = [
  {
    n: '01',
    title: 'Analyze',
    desc: 'AI agents continuously monitor balances, obligations, market conditions, and yield opportunities across all connected accounts.',
  },
  {
    n: '02',
    title: 'Propose',
    desc: 'The orchestration layer generates risk-scored proposed actions with full reasoning and explainability for every queued operation.',
  },
  {
    n: '03',
    title: 'Approve',
    desc: 'Human reviewers evaluate insights through role-based approval workflows. Multi-signature support for high-value operations.',
  },
  {
    n: '04',
    title: 'Execute',
    desc: 'Approved actions are executed atomically with real-time monitoring. Every step is logged to an immutable audit trail.',
  },
];

export function AIFlow() {
  return (
    <section id="agent" className="relative py-24 lg:py-32 overflow-hidden bg-[var(--bg-void)]">
      {/* Teal bloom — single decoration */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(45,212,191,0.06) 0%, transparent 60%)',
          filter: 'blur(60px)',
        }}
        aria-hidden
      />

      <div className="relative max-w-7xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-16 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Agentic intelligence, human control
        </h2>

        {/* Row 1: Diagram */}
        <div className="mb-24">
          <AIFlowDiagram />
        </div>

        {/* Row 2: Insight feed */}
        <div className="mb-24">
          <InsightFeed />
        </div>

        {/* Row 3: 4-step narrative */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="p-6 rounded-xl border border-white/[0.06] bg-white/[0.025] min-h-[160px]"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-medium text-[var(--teal-400)] tracking-wider">{s.n}</span>
                <h3 className="text-base font-semibold text-white" style={{ letterSpacing: '-0.012em' }}>
                  {s.title}
                </h3>
              </div>
              <p className="text-sm text-[var(--text-300)] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

Notes:
- The section uses `id="agent"` to preserve the existing anchor link from the navbar (the navbar still has `#agent` in its `navLinks` array — we keep it).
- Section background is `bg-[var(--bg-void)]` plus a single teal bloom decoration. No metric pills, no eyebrow.
- 96px breathing room between rows (`mb-24` = 96px).
- 4-step narrative grid: 1 col → 2×2 → 4 col, per spec §7.2.
- The 4-step copy is the existing copy from the old `AgentSection` at `page.tsx:838-842` — preserved per spec §"Existing narrative sections".

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Temporarily mount AIFlow to verify**

```tsx
import { AIFlow as TempAIFlow } from '@/components/landing/AIFlow';
// add somewhere in LandingPage, e.g. before <Features />:
<TempAIFlow />
```

- [ ] **Step 4: Visual smoke**

Refresh. Scroll to the new AI Flow section. Verify:
- Title `Agentic intelligence, human control` (no eyebrow)
- Diagram renders with particles flowing (desktop) or beam-and-orb (mobile)
- Insight feed rotates underneath
- 4 narrative cards in a row at desktop, 2×2 at md, 1 col at base
- 96px breathing between each row
- Single teal bloom decoration in the background, no other gradients

- [ ] **Step 5: Revert the temporary mount**

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/AIFlow.tsx
git commit -m "$(cat <<'EOF'
feat(landing): build AIFlow section shell with title and 4-step narrative

Composes AIFlowDiagram + InsightFeed + the 4-step Analyze/Propose/
Approve/Execute narrative under the locked title "Agentic intelligence,
human control". Single teal bloom decoration on a void background, 96px
breathing room between the three rows. The 4-step copy is preserved
verbatim from the old AgentSection per spec section "Existing narrative
sections". id="agent" preserved as the navbar anchor target.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: ContactForm — extract with iOS auto-zoom fix

**Goal:** Extract the contact form from `page.tsx:957-1073` into its own file. Preserve the `/api/contact` POST handler verbatim. Bump input font-size to 16px on mobile to prevent iOS Safari auto-zoom on focus per spec §7.2.

**Files:**
- Modify: `src/components/landing/ContactForm.tsx` (replace stub)

- [ ] **Step 1: Replace ContactForm.tsx**

Copy the `ContactForm` function body from `page.tsx:957-1073` verbatim. The only changes are:
1. Move from `function ContactForm()` to `export function ContactForm()`
2. Imports at the top (the rest of the JSX is identical)
3. The 3 `<input>` and 1 `<textarea>` get `text-base` (16px) explicitly to prevent iOS auto-zoom
4. Submit button gets `min-h-[48px]` for the mobile touch target floor
5. Section background changes to `var(--bg-deep-navy)` (the wind-down beat)
6. Eyebrow line is removed (spec §"Eyebrow labels — removed")
7. The section title becomes `Get in touch` (the old `Ready to Optimize Your Treasury?` is dropped along with the eyebrow)

```tsx
'use client';

import { useState, useRef } from 'react';
import { Send, CheckCircle2 } from 'lucide-react';

export function ContactForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('sending');
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fd.get('name'),
          email: fd.get('email'),
          company: fd.get('company'),
          message: fd.get('message'),
        }),
      });
      if (!res.ok) throw new Error();
      setStatus('sent');
      formRef.current?.reset();
    } catch {
      setStatus('error');
    }
  };

  return (
    <section id="contact" className="relative py-24 lg:py-32" style={{ background: 'var(--bg-deep-navy)' }}>
      <div className="max-w-2xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl font-semibold text-white text-center mb-12 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Get in touch
        </h2>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="p-8 sm:p-10 rounded-xl bg-white/[0.025] border border-white/[0.06] space-y-6"
        >
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-[var(--text-200)] mb-2">Name</label>
              <input
                name="name"
                required
                className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-all duration-300"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-200)] mb-2">Email</label>
              <input
                name="email"
                type="email"
                required
                className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-all duration-300"
                placeholder="you@company.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-200)] mb-2">Company</label>
            <input
              name="company"
              className="w-full px-4 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-all duration-300"
              placeholder="Company name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text-200)] mb-2">Message</label>
            <textarea
              name="message"
              required
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-[var(--text-400)] focus:outline-none focus:border-[var(--teal-400)]/50 focus:ring-1 focus:ring-[var(--teal-400)]/25 transition-all duration-300 resize-none"
              placeholder="Tell us about your treasury needs..."
            />
          </div>
          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full sm:w-auto min-h-[48px] px-8 py-3.5 rounded-full text-sm font-semibold bg-gradient-to-r from-teal-500 to-cyan-400 text-white hover:shadow-[0_0_32px_rgba(45,212,191,0.4)] transition-all duration-500 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {status === 'sending' ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send size={16} />
                Send Message
              </>
            )}
          </button>
          {status === 'sent' && (
            <p className="text-[var(--teal-400)] text-sm flex items-center gap-2">
              <CheckCircle2 size={16} /> Message sent. We&apos;ll be in touch shortly.
            </p>
          )}
          {status === 'error' && (
            <p className="text-red-400 text-sm">Something went wrong. Please email contact@vantor.xyz directly.</p>
          )}
        </form>
      </div>
    </section>
  );
}
```

The handler is byte-identical to the existing one. Inputs explicitly use `text-base` (16px) — this is what prevents iOS Safari auto-zooming when the user taps a field.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/ContactForm.tsx
git commit -m "$(cat <<'EOF'
feat(landing): extract ContactForm with iOS auto-zoom fix

Pulls ContactForm out of page.tsx into its own component. Handler is
preserved verbatim — same POST to /api/contact, same idle/sending/
sent/error states. Inputs explicitly use text-base (16px) to prevent
iOS Safari auto-zoom on focus per spec section 7.2. Submit button gets
48px min-height for the mobile touch target floor. Section background
moves to deep-navy (the wind-down beat) and the eyebrow + old title
are dropped — new title is "Get in touch".

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Footer — extract verbatim

**Goal:** Move the Footer from `page.tsx:1078-1100` into its own file with no content changes.

**Files:**
- Modify: `src/components/landing/Footer.tsx` (replace stub)

- [ ] **Step 1: Replace Footer.tsx**

```tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-12" style={{ background: 'var(--bg-deep-navy)' }}>
      <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <Image src="/logo-dark.png" alt="Vantor" width={100} height={32} className="object-contain opacity-60" unoptimized />
        </div>
        <p className="text-[var(--text-300)] text-sm">&copy; {new Date().getFullYear()} Vantor Treasury, Inc. All rights reserved.</p>
        <div className="flex items-center gap-6 flex-wrap justify-center">
          <a href="#platform" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">Platform</a>
          <a href="#agent" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">AI Agent</a>
          <a href="#contact" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">Contact</a>
          <Link href="/terms" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">Terms</Link>
          <Link href="/privacy" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">Privacy</Link>
          <a href="https://www.linkedin.com/company/vantortreasury" target="_blank" rel="noopener noreferrer" className="text-[var(--text-300)] hover:text-[var(--text-100)] transition-colors" aria-label="LinkedIn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          </a>
          <a href="https://www.x.com/VantorTreasury" target="_blank" rel="noopener noreferrer" className="text-[var(--text-300)] hover:text-[var(--text-100)] transition-colors" aria-label="X">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
```

The only changes from the original:
- `text-gray-500` → `text-[var(--text-300)]` (the v5.5 a11y bump from 4.0:1 to 7.6:1 contrast)
- Background is explicitly `--bg-deep-navy` (matches the contact form, the wind-down pair)
- `#features` and `#security` anchors are removed since those sections are gone — replaced with `#platform` and `#agent`

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/Footer.tsx
git commit -m "$(cat <<'EOF'
feat(landing): extract Footer with v5.5 a11y contrast bump

Footer extracted to its own component with two changes from the
original: text-gray-500 (#6b7280, fails AA at 4.0:1) is replaced with
text-[var(--text-300)] (#9ca3af, 7.6:1) per the v5.5 a11y pass, and
the dropped #features and #security anchors are replaced with the new
#platform and #agent targets.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Wire page.tsx + delete dead inline code + purge dead CSS

**Goal:** Rewrite `page.tsx` as a thin composition root that imports from `@/components/landing/`. Delete the inlined Navbar/Hero/Features/AgentSection/Security/PartnerScroll/etc. functions. Purge the now-dead `.blob-*`, `.partner-scroll-*`, and `.hero-badge-glow` CSS from `globals.css`. **Move the `blobFloat1/2/3` keyframes** into `globals.css` permanent section (BlobBackground still references them by name).

**Files:**
- Modify: `src/app/page.tsx` (rewrite from 1123 lines to ~30)
- Modify: `src/app/globals.css` (purge dead classes, keep `blobFloat*` keyframes)

- [ ] **Step 1: Rewrite page.tsx as the composition root**

Replace the entire contents of `src/app/page.tsx` with:

```tsx
'use client';

import {
  Navbar,
  Hero,
  AIFlow,
  CapabilityGrid,
  FeatureCarousel,
  TrustBand,
  ContactForm,
  Footer,
} from '@/components/landing';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-void)] text-white overflow-x-hidden landing-page">
      <Navbar />
      <main>
        <Hero />
        <AIFlow />
        <CapabilityGrid />
        <FeatureCarousel />
        <TrustBand />
        <ContactForm />
      </main>
      <Footer />
    </div>
  );
}
```

That's the whole file. The `'use client'` directive matches the existing pattern at `page.tsx:1` and avoids any server/client boundary surprises — the imported leaves are all `'use client'` anyway, so this just keeps the page itself on the client side and the file under 30 lines.

- [ ] **Step 2: Purge dead CSS from globals.css**

Open `src/app/globals.css`. Delete these blocks (line numbers are approximate — find by class name):

1. `.blob-wrap`, `.blob`, `.blob-1`, `.blob-2`, `.blob-3` — the class definitions only (NOT the `@keyframes blobFloat1/2/3` — those still drive `BlobBackground.tsx`'s inline style animations).
2. `.partner-scroll-track` and `:hover` variant + `@keyframes partnerScroll`
3. `.hero-badge-glow` + `@keyframes badgePulse`

Keep:
- `@keyframes blobFloat1`, `blobFloat2`, `blobFloat3` (referenced by inline styles in `BlobBackground.tsx`)
- `.landing-page`, `.landing-fade-in`, `.landing-delay-1..4`, `@keyframes landingFadeIn`
- `.login-dropdown`, `.login-dropdown-open`, `.login-dropdown-closed`
- All non-landing CSS (scrollbars, glass-sm, fade-in, dropdownIn, navProgress)
- The new Task 1 additions (color tokens, focus-visible ring, prefers-reduced-motion rule)
- The new Task 9 additions (`@keyframes aiFlowOrbPulse`, `aiFlowBeam`)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Visual smoke — full page**

`npm run dev` is still running. Refresh `http://localhost:3000` and walk through the entire page top to bottom:

1. **Navbar** — logo, 4 nav links, login button on the right at lg+. At < lg, hamburger appears.
2. **Hero** — headline with gradient line 2, sub-pitch matches locked copy, 2 CTAs, NetworkCanvas + BlobBackground visible, no metric pills.
3. **AI Flow** — section title, diagram with flowing particles (desktop) or beam-and-orb (mobile), insight feed rotating below, 4 narrative cards.
4. **Capability Grid** — 6 cards 3×2, no Vantor prefix, hover changes border only.
5. **Feature Carousel** — 3 slides, dot nav, deep-navy background.
6. **Trust Band** — 6 pillars including Enterprise-Grade Security, narrow max-w-4xl.
7. **Contact Form** — Get in touch title, form on deep-navy background.
8. **Footer** — logo, copyright, link row.

Then resize down to 360px and walk through again. Everything should be legible, no horizontal scroll.

- [ ] **Step 5: Run next build**

```bash
npm run build
```

This is the heavier check (will take 30-90s — flag this to the user before running). Expected: green build, zero errors, zero new lint warnings.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/globals.css
git commit -m "$(cat <<'EOF'
refactor(landing): wire v5.6 composition root and purge dead CSS

page.tsx becomes a 25-line thin composition root that imports the 8
mounted components from src/components/landing/. The 1100 lines of
inlined Navbar/Hero/PartnerScroll/Features/AgentSection/Security/
ContactForm/Footer/NetworkCanvas/BlobBackground definitions are
deleted in this commit. globals.css drops the now-dead .blob-*,
.partner-scroll-*, and .hero-badge-glow classes; the blobFloat1/2/3
keyframes are kept because BlobBackground.tsx still references them by
name from inline styles.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Final mobile, a11y, and Lighthouse audit

**Goal:** Walk every spec §9 validation gate, fix anything below the floor, and only commit if all 10 gates pass. This is the merge gate — if anything in here fails, the PR is not ready.

**Files:** May modify any landing component to fix issues found in this audit.

- [ ] **Step 1: Build green**

```bash
npm run build
```

Expected: zero TypeScript errors, zero new lint warnings. If lint warns about something we introduced, fix it before continuing.

- [ ] **Step 2: Visual parity at 1440px**

Open `landing-v5-preview.html` from the repo root in one browser tab and `http://localhost:3000` in another. Side-by-side compare each section. They should match in:
- Section order
- Density rhythm (low → HIGH → medium → HIGH → medium → low)
- Tonal registers (void, deep-navy, void, deep-navy)
- Gradient placement (only on hero h1 line 2 + Get Started Free button)
- Card border weights, hover effects
- Spacing and section padding

Spot-check, not pixel-perfect — the live page is React and the mockup is hand-coded HTML, so minor positioning differences are expected.

- [ ] **Step 3: Mobile audit at 360 / 414 / 768**

Open DevTools, switch to device toolbar, walk each width:

**360px (iPhone SE):**
- [ ] No horizontal scroll
- [ ] Hero headline ≤ 4 lines
- [ ] Hero CTAs stack vertically, full-width, ≥ 48px tall
- [ ] AI Flow shows the simpler beam-and-orb mobile layout (orb pulsing, beam pulsing) — NOT the desktop SVG
- [ ] Insight feed shows 1 card
- [ ] Capability grid stacks 1 col
- [ ] Feature carousel: text above mockup, swipeable
- [ ] Trust band stacks 1 col
- [ ] Contact form inputs are 16px (verify by tapping a field — iOS should NOT auto-zoom)
- [ ] Footer wraps cleanly

**414px (iPhone 14 Pro Max):**
- [ ] Same as 360 but type one step larger (sm: kicks in at 640px so this is still base)

**768px (iPad portrait):**
- [ ] Capability grid is 2×3
- [ ] Trust band is 2×3
- [ ] AI Flow narrative is 2×2
- [ ] AI Flow diagram is STILL the mobile beam-and-orb layout (the desktop SVG doesn't kick in until lg = 1024px, this is intentional per spec §9.3)
- [ ] Feature carousel is still stacked text-above-mockup

If any check fails, fix it now and re-run the audit before moving on.

- [ ] **Step 4: Touch targets**

In DevTools device toolbar (touch emulation enabled), inspect each interactive element. Every link, button, dot, hamburger, form input, and the insight `Approve?` pill must have a hit area ≥ 44×44px. Cross-reference against spec §7.3.

- [ ] **Step 5: prefers-reduced-motion**

DevTools → Rendering panel → "Emulate CSS media feature prefers-reduced-motion" → "reduce". Walk the page and verify:
- [ ] NetworkCanvas: no particles, canvas is blank or hidden
- [ ] BlobBackground: blobs are static (the global rule damps the animation duration to 0.001ms)
- [ ] AI Flow orb: not pulsing
- [ ] AI Flow particles (desktop): not moving
- [ ] AI Flow beams (mobile): not pulsing
- [ ] Insight feed: not rotating
- [ ] Carousel slide transitions: instant
- [ ] Hero entrance fade-in: instant

Toggle reduced-motion off again and verify everything resumes.

- [ ] **Step 6: Keyboard tab order**

Click in the URL bar, press Tab repeatedly. Order should be:
1. Skip-link (if any)
2. Logo link
3. Each navbar nav link in order
4. Login button (or sign-in form fields if dropdown is open)
5. Hero CTAs (Get Started Free, then Explore Platform)
6. AI Flow Approve? buttons in the visible feed
7. Capability grid cards (if focusable)
8. Feature carousel arrows + dots
9. Trust band cards (if focusable)
10. Contact form fields, Submit
11. Footer links

Every focusable element must show a visible focus ring (the teal ring from the Task 1 token). If any focus ring is missing, find the offending element and verify it doesn't have `outline: none` without a replacement.

- [ ] **Step 7: Lighthouse mobile**

Open DevTools → Lighthouse tab → Mode: Navigation → Device: Mobile → Categories: Performance, Accessibility, Best Practices → Throttling: Slow 4G + Moto G Power CPU → Generate report.

Targets per spec §9.6:
- Performance ≥ 85
- Accessibility ≥ 95
- Best Practices ≥ 95

If Performance is below 85, the most likely culprits are:
1. NetworkCanvas particle count too high — drop the mobile cap from 30 to 20 in `HeroBackdrop.tsx`
2. BlobBackground blur radius too high — drop the mobile blur from 60px to 40px
3. Hero images not optimized — verify `/logo-dark.png` is small

If Accessibility is below 95, the report will list specific issues — fix them.

- [ ] **Step 8: Sign-in still works**

In the running dev server, sign in via the Navbar dropdown with a real seeded user. Verify:
- [ ] Form accepts email + password
- [ ] On success, redirects to `/dashboard`
- [ ] On invalid credentials, shows the error
- [ ] On unverified email, shows the verification prompt
- [ ] Forgot password link goes to `/forgot-password`

Then sign out and try the mobile sheet sign-in form (resize to 800px, hamburger → form is inline in the sheet). Same checks.

- [ ] **Step 9: Contact form still works**

Submit the contact form with valid name/email/company/message. Verify:
- [ ] Sending state shows the spinner
- [ ] On success, shows the green checkmark message
- [ ] Network tab confirms the POST to `/api/contact` returned 200

(If `/api/contact` is wired to Resend in dev, this will actually send an email. If you don't want that, use a test email address.)

- [ ] **Step 10: Final commit if everything passes**

If all 9 prior gates pass, there's nothing to commit — Tasks 1-13 already shipped the code. This step is just a verification milestone. If you found and fixed issues during the audit, commit them now:

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(landing): final v5.6 audit fixes

Fixes uncovered during the Task 14 spec section 9 validation pass:
[list specific fixes here, e.g.:
 - drop NetworkCanvas mobile particle cap from 30 to 20 for Lighthouse perf
 - add focus-visible ring to InsightFeed Approve? button
 - bump Hero CTA to 48px min-height (was 44 in Task 4)]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

If everything passed without fixes, just push the branch and open the PR.

```bash
git push origin feature/landing-refresh
```

---

## Done

When Task 14 is complete and the PR is open, the v5.6 landing refresh is ready for human review and merge to `master` (which auto-deploys to https://www.vantor.xyz via Vercel).

**Out of scope for this PR (per spec §10) — do NOT add:**
- Real product screenshots for the carousel (follow-up)
- Partner / customer logo strip
- Any change to `/api/contact`, `/api/auth/check-verified`, `middleware.ts`, NextAuth config
- Framer Motion or any new dependency
- Testimonial carousel, autoplay, parallax, sparkle effects
- Re-introducing General Sans, eyebrow labels, metric pills, the orbital diagram, free-floating chip orbs, or any glass material
- The "Vantor" prefix on capability cards
- Changes to the locked insight strings 1-5
