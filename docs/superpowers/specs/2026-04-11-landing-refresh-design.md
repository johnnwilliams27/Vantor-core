# Landing Page Refresh — Vantor v5.6 — Design Spec

**Date:** 2026-04-11
**Branch:** `feature/landing-refresh`
**Worktree:** `.worktrees/landing-refresh` (off `master` at `be22fe6`)
**Status:** Draft for review — supersedes the stale v4-era plan at `docs/superpowers/plans/2026-04-11-landing-refresh.md`
**Source of truth (visual):** `landing-v5-preview.html` (v5.6, repo root, 1320 lines)
**Source of truth (decisions):** `~/.claude/.../memory/project_landing_page_refresh.md`

## 1. Goal

Replace the current `src/app/page.tsx` (1123 lines, all sections inlined) with the v5.6 geometric-editorial direction approved across two brainstorming sessions, extracted into focused components under `src/components/landing/`. Make every section work cleanly on mobile from 360px up — mobile is a first-class requirement, not a downgrade pass.

The page has **one** memorable motion moment: the AI Flow section (orb + flowing particles + rotating insight feed + 4-step narrative). Everything else is scenery whose job is to let that beat land.

## 2. Reality check — what already exists

| v5.6 needs | Already in `page.tsx` | Verdict |
|---|---|---|
| Navbar with sign-in dropdown | Lines 405–520 — inlined NextAuth `signIn('credentials')`, password reveal, "forgot password" link | **Extract + preserve verbatim.** Sign-in is load-bearing. |
| Hero with NetworkCanvas + BlobBackground + radial vignette | `NetworkCanvas` (313–325), `BlobBackground` (327–337), `.hero-vignette`, blob CSS in globals | **Keep all three.** v5 iteration un-vetoed them after orbital/orbs were rejected. |
| Hero metric pills (5 floating chips) | Inlined in hero section | **Delete.** Vetoed in spec memory. |
| AI Flow diagram + insight feed + 4-step narrative | None — `AgentSection` exists with the 4-step content but uses an 8-bullet right column we're dropping | **Build new.** Reuse the 4-step copy from `AgentSection`; everything else is new. |
| Capability grid (6 cards, 3×2, pure void) | `Features` section has different content + different card structure | **Replace.** Integration content survives inside the new Connect card. |
| Feature carousel (3 slides, no autoplay) | None | **Build new.** v1 uses styled mockups, not real screenshots. |
| Trust band (6 pillars, narrow `max-w-4xl`) | `Security` section with 5 pillars in a wider container | **Replace.** Reuses 5 of 6 pillar copy strings; adds Enterprise-Grade Security as the 6th. |
| Contact form | Inlined `<form>` POSTing to `/api/contact` | **Extract + preserve handler.** No API change. |
| Footer | Inlined | **Extract.** No content change. |
| Inter typography | Inter loaded via `next/font/google` already (likely) | **Verify and standardize the weight system.** |
| `NetworkCanvas`, `BlobBackground`, `PartnerScroll`, `Features`, `AgentSection`, `Security`, `SectionHeading` | All imported by current `page.tsx` | Keep `NetworkCanvas` + `BlobBackground`. **Delete** `PartnerScroll`, old `Features`, old `AgentSection`, old `Security`, old `SectionHeading` once the new components compile. |
| Dead CSS in `globals.css` | `.blob-*`, `.partner-scroll-*`, `.hero-badge-glow`, hero metric pill classes | **Purge** in the same PR — but only after the new page works without them. |

**APIs / routes touched:** none. `/api/contact`, `/api/auth/check-verified`, `middleware.ts` are out of scope.

## 3. Visual direction — locked

**Geometric-editorial.** Precise, typographic, institutional. Linear × Stripe × editorial magazine. No organic shapes, no synthwave glow, no playful icons, no purple/pink gradients, no crypto-bro styling.

The mesh canvas + blob background in the hero is the *only* atmospheric element on the page. Every other section is flat surfaces, hairline borders, and disciplined typography. The contrast is what gives the AI Flow bloom its weight when you scroll into it.

## 4. Page structure — locked

| # | Section | Background | Density | Notes |
|---|---|---|---|---|
| 1 | Navbar | Translucent → solid on scroll | — | Sign-in dropdown preserved as-is |
| 2 | Hero | `#060d1f` void + NetworkCanvas + BlobBackground + radial teal vignette | low | Headline + sub-pitch + 2 CTAs only — no metric pills |
| 3 | AI Flow | `#060d1f` void + teal bloom | **HIGH** | Three rows: diagram, insight feed, 4-step narrative. The memorable moment. |
| 4 | Capability Grid | `#060d1f` pure void (deliberately flat) | medium | 6 cards, 3×2 |
| 5 | Feature Carousel | `#040a18` deep navy (zoom-in beat) | **HIGH** | 3 slides, dot nav, no autoplay |
| 6 | Trust Band | `#060d1f` void, narrow `max-w-4xl` | medium | 6 pillars, footnote-asymmetric width |
| 7 | Contact Form | `#040a18` deep navy (wind-down beat) | low | Single column, ≤640px |
| 8 | Footer | `#040a18` deep navy | low | Stacks on mobile |

**Density rhythm:** low → HIGH → medium → HIGH → medium → low. Never two heavy sections back-to-back.
**Deep navy `#040a18` is used exactly twice** — carousel and contact/footer. Do not spread it.

## 5. Copy — locked

All copy is locked in memory. The spec just points to it; no copy decisions to make here.

- **Hero headline:** `Put Your Idle Treasury / Reserves to Work` (gradient teal→cyan on line 2)
- **Hero sub-pitch:** the yield-before-FX paragraph from memory ("Vantor provides full visibility…")
- **Hero CTAs:** `Get Started Free` (gradient pill) · `Explore Platform` (outline; href `#platform` = capability grid, NOT the AI flow)
- **AI Flow section title:** `Agentic intelligence, human control`
- **AI Flow inputs:** `Upcoming AR/AP` · `Cash · Banks + Wallets` · `Treasury Policy` · `FX Exposure`
- **AI Flow outputs:** `Spiko USD` · `Circle USYC` · `FX Rebalance` · `Payments`
- **AI Flow center node label:** `Vantor AI`
- **Insight feed (5 cards, all use the same teal `Approve?` pill):** see memory §"Insight feed"
- **Capability grid title:** `Modern treasury management — powered by AI`
- **Capability cards (6, no "Vantor" prefix):** Command Center, Treasury, Yield, Compliance, Connect, Data — full bullets in memory
- **Trust band pillars (6):** AML & Sanctions, Transaction Monitoring, Audit Logging, Role-Based Permissions, Approval Workflows, Enterprise-Grade Security — full body text in memory

**Eyebrow labels are dead.** No teal uppercase pretext lines above any section title. Section titles carry the beat alone.

## 6. Design system — locked

### 6.1 Typography (Inter, locked v5.6)

Single-family precision system, "Modern Dark Cinema (Inter System)" pairing per ui-ux-pro-max audit.

| Role | Size | Inter weight | Letter-spacing |
|---|---|---|---|
| Display (hero h1) | 40–64px | **700** | -0.028em |
| H2 (section titles) | 30–40px | **600** *(not 700)* | -0.018em |
| H3 (sub-headings) | 16–20px | **600** | -0.01 to -0.015em |
| Body | 16px | **400** | -0.005em |
| Labels (uppercase) | 10–12px | **500** | +0.08 to +0.12em |

The earlier "General Sans" decision is **superseded.** Do not load `next/font/local` for General Sans. Use `next/font/google` for Inter with the weight set above (preload only the weights actually used).

### 6.2 Color tokens

Add to `globals.css`:

```css
--bg-void: #060d1f;
--bg-deep-navy: #040a18;
--teal-400: #2dd4bf;
--cyan-300: #67e8f9;
--text-100: #e5e7eb;
--text-200: #d1d5db;
--text-300: #9ca3af;  /* footer / slide-counter — was #6b7280 in v5.4, bumped in v5.5 a11y pass */
--text-400: #6b7280;
```

### 6.3 Gradient discipline

Exactly **two** gradients on the entire page:
1. Hero headline line 2 (teal → cyan)
2. Primary CTA button (`Get Started Free`)

Every other gradient is disabled. Rarity is the point.

### 6.4 Spacing

4px base. Strict scale: `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128`. No arbitrary margins. Section vertical padding 96–128px on desktop, 64–80px on mobile.

### 6.5 Surfaces

- 1px hairline borders on every card (`border-white/[0.06]` → `border-white/[0.12]` on hover)
- 12px card radius
- Card fill: `rgba(255,255,255,0.025)`
- **No drop shadows** anywhere except the carousel screenshot frames
- Hover = border color shift only. No lift, no scale, no bounce.

### 6.6 Motion budget

| Section | Motion | Cadence |
|---|---|---|
| Hero | 3-element entrance stagger on mount | 300ms each, once |
| AI Flow | Orb pulse (CSS keyframes) + particles along SVG `offset-path` + feed rotation | Pulse 2.4s loop · particles 2s travel slowing to steady-state after 3 loops · feed 5s cadence, 25s full loop, pause on hover |
| Capability Grid | Scroll-triggered rise (24px + fade) | 60ms stagger, once |
| Carousel | Slide transition | 400ms on click, no autoplay |
| Trust Band | None | — |
| Footer | None | — |

All motion **must** respect `prefers-reduced-motion: reduce`. Already wired in v5.6 — replicate the rule in `globals.css`.

### 6.7 Accessibility (v5.5 a11y pass — locked)

- `:focus-visible` ring on every interactive element (link, button, input, dot, chip). Token: `box-shadow: 0 0 0 2px var(--bg-void), 0 0 0 4px var(--teal-400);`
- Footer / slide-counter / muted-text uses `--text-300` (`#9ca3af`, 7.6:1 on void) — **never** `#6b7280` (4.0:1, fails AA for small text).
- Form inputs keep their focus ring — do **not** apply `outline: none` without replacing it.
- Decorative SVGs and canvas elements get `aria-hidden="true"`.
- Insight feed needs `aria-live="polite"` so screen readers announce rotations without hijacking focus.

## 7. Mobile responsiveness — first-class requirement

This is the new layer compared to v5.6. The current mockup has exactly one breakpoint at 900px and does the bare minimum (collapse grids to 1 column, hide nav links). That's not enough.

### 7.1 Breakpoint system

Use Tailwind's defaults — **no custom breakpoints**:

| Name | Min width | Target |
|---|---|---|
| (base) | 0 | iPhone SE / small Android — 360px design floor |
| `sm` | 640px | Large phones, portrait phablets |
| `md` | 768px | Tablets portrait |
| `lg` | 1024px | Tablets landscape, small laptops |
| `xl` | 1280px | Desktop |

Author **mobile-first**: base styles target 360px, then `sm:` / `md:` / `lg:` add desktop polish. Do **not** write desktop styles and override down with `max-width` queries.

### 7.2 Section-by-section mobile behavior

**Navbar**
- Mobile: logo + hamburger only. Hamburger opens a full-screen sheet (`fixed inset-0`) with the 4 nav links + sign-in CTA stacked, 56px tap targets each. Backdrop blur + close on link tap.
- `lg:` and up: current horizontal nav.
- **Do not** hide the sign-in CTA on mobile — surface it inside the sheet.

**Hero**
- h1 scales: `text-4xl` (36px) base → `sm:text-5xl` → `lg:text-6xl` (64px). Letter-spacing eases at smaller sizes (`-0.02em` base → `-0.028em` lg).
- Sub-pitch: `text-base` base → `lg:text-lg`. Max-width clamps to viewport on mobile.
- CTAs: stack vertically on base, side-by-side at `sm:`. Each CTA min-height 48px, full-width on base (`w-full sm:w-auto`).
- Hero vertical padding: `pt-32 pb-20` base → `lg:pt-40 lg:pb-32`. Account for the fixed navbar.
- **NetworkCanvas + BlobBackground:** keep on mobile but cap density. NetworkCanvas particle count drops from ~80 to ~30 below `md`. BlobBackground uses smaller blur radius below `md` (heavy `filter: blur(120px)` is the single biggest paint cost on mobile Safari).
- Auto-disable NetworkCanvas only if `prefers-reduced-motion: reduce` is set. BlobBackground stays, just with the smaller blur radius from §7.5. Do not gate either on device memory — `navigator.deviceMemory` is unreliable cross-browser and the density caps in §7.5 already handle the perf budget.

**AI Flow — diagram (row 1)**
- Desktop: `inputs column → orb → outputs column` horizontal layout with SVG paths flowing left→right.
- Mobile: vertical stack — inputs row (4 chips wrapping in a 2×2 grid), orb centered, outputs row (4 chips wrapping in a 2×2 grid). SVG paths re-flow vertical: top chips fan into the orb, orb fans into bottom chips. **Particle animation runs along the new vertical paths** — do not just hide them on mobile.
- If reflowing the SVG paths is too complex: fall back to a simplified mobile layout where the orb sits center, chips are arranged in a 2×4 grid above and below, and a single subtle teal beam pulses between input grid → orb → output grid.

**AI Flow — insight feed (row 2)**
- Desktop: 3 cards visible at once, opacities 1.0 / 0.85 / 0.6.
- Mobile: 1 card visible at base, 2 cards at `sm:`. Same 5s rotation cadence. Cards use full container width with 16px side padding. Cards must be tall enough that the `Approve?` pill never wraps under the amount text.
- Pause-on-hover does nothing on touch — also pause on `:focus-within` so keyboard users can read the cards.

**AI Flow — 4-step narrative (row 3)**
- Desktop: 4-column grid.
- `md:` 2×2 grid.
- Base: 1 column stack with 24px gap.
- Each step card has min-height 140px so the rhythm doesn't collapse to text.

**Capability Grid (row 4)**
- Desktop: 3×2 grid.
- `md:` 2×3 grid.
- Base: 1 column stack.
- Cards use the same `min-h-[200px]` so the heights don't jitter when scrolling.
- Bullet lists use `text-sm` on mobile, `text-base` on desktop.

**Feature Carousel (row 5)**
- Desktop: 2-column (text + framed screenshot side-by-side).
- Base / `sm:` / `md:`: stack — text above, screenshot below. Screenshot frame max-width 100% with side padding so the radial teal glow behind it isn't clipped.
- **Slide controls:**
  - Dot nav stays on all viewports — minimum 24×24px tap target with the visible dot 8×8px centered inside (touch target ≥ visible affordance, per Apple HIG and WCAG 2.5.5).
  - Add **horizontal swipe** on touch (basic touchstart/touchend deltaX threshold ≈50px). No external lib — ~30 lines of vanilla.
  - Slide arrows hidden on base, visible at `lg:`.

**Trust Band (row 6)**
- Desktop: `max-w-4xl` 3×2 grid (the locked footnote-asymmetric width).
- `md:` 2×3 grid.
- Base: 1 column stack.
- Container side padding 24px on base.

**Contact Form (row 7)**
- Already a single column at any width — only structural change is to ensure all inputs use `text-base` (16px) on mobile to **prevent iOS Safari auto-zoom on focus**. This is a hard rule.
- Submit button full-width on mobile, auto width at `sm:`.
- Min tap height 48px on every input and the submit button.

**Footer (row 8)**
- Already stacks on base in v5.6 — preserve.
- Center-align everything on base, left/right at `lg:`.

### 7.3 Touch target floor

Every interactive element — link, button, dot, hamburger, form input, insight card, nav-cta — must have a hit area of **at least 44×44px** (Apple HIG) on touch viewports. The visible affordance can be smaller; pad the click target with invisible inset.

### 7.4 Typography clamping

For the hero h1 only, use `clamp()` so it scales smoothly between 360px and 1280px instead of stepping at named breakpoints:

```css
font-size: clamp(2.25rem, 1.5rem + 3.5vw, 4rem);
```

All other type uses Tailwind responsive utilities.

### 7.5 Mobile performance budget

The page already lazy-loads nothing — every section ships in the initial bundle. Constraints:

- **NetworkCanvas:** particle count `0..767px` = 30, `768..1279px` = 60, `1280px+` = 80. Read viewport once on mount.
- **BlobBackground blur radius:** `0..767px` = 60px, `768px+` = 120px. CSS `filter: blur()` is the dominant mobile paint cost.
- **Hero animations** auto-pause on document `visibilitychange` (already wired in v5.6 — preserve).
- **Carousel screenshot frames:** mockups are SVG/CSS for v1 (no real images). When real PNG screenshots arrive, they must use `next/image` with `sizes` and a max width of 1280.
- **No new fonts** beyond Inter.
- **Lighthouse mobile score target:** Performance ≥ 85, Accessibility ≥ 95, Best Practices ≥ 95. This is the validation gate — see §9.

### 7.6 What is **not** changing for mobile

- The five locked insight strings — same on mobile.
- The capability grid copy — same on mobile.
- The hero copy — same on mobile.
- The motion philosophy — particles still run on the AI Flow on mobile (just along reflowed paths). The "memorable moment" must still land on a phone.

## 8. Component breakdown

### Files to create

```
src/components/landing/
  Navbar.tsx           # extracted; preserves NextAuth signIn dropdown verbatim; adds mobile sheet
  Hero.tsx             # new shell — headline, sub-pitch, 2 CTAs, NO metric pills
  HeroBackdrop.tsx     # wraps NetworkCanvas + BlobBackground + radial vignette;
                       #   reads viewport size on mount and passes density props
  AIFlow.tsx           # section shell + diagram (row 1) + 4-step narrative (row 3)
  AIFlowDiagram.tsx    # SVG: chips → orb → chips with offset-path particle anim;
                       #   internal layout switches between horizontal and vertical at md
  InsightFeed.tsx      # 5-card rotation, aria-live=polite, pause on hover/focus
  CapabilityGrid.tsx   # 6 cards, 3×2 → 2×3 → 1 col
  FeatureCarousel.tsx  # 3 slides, dot nav, touch swipe, no autoplay
  TrustBand.tsx        # 6 pillars, narrow max-w-4xl
  ContactForm.tsx      # extracted; preserves POST /api/contact handler
  Footer.tsx           # extracted; no content change
  index.ts             # barrel re-export
```

The existing `NetworkCanvas` and `BlobBackground` components stay where they live today; `HeroBackdrop` just composes them. Density props are added to those components in the same PR.

### Files to modify

```
src/app/page.tsx         # rewrite as a thin composition root
src/app/globals.css      # add color tokens, mobile-tuned blob blur, focus-visible
                         #   ring token, prefers-reduced-motion rules; purge dead classes
                         #   AFTER new page works
```

### Files to delete (only after new page is green)

```
src/components/PartnerScroll.tsx     # vetoed (no logo strip)
src/components/Features.tsx          # replaced by CapabilityGrid
src/components/AgentSection.tsx      # replaced by AIFlow (4-step copy migrates)
src/components/Security.tsx          # replaced by TrustBand
src/components/SectionHeading.tsx    # if no remaining callers
```

Each delete is a separate commit so rollback is trivial. The implementation plan will sequence them after the new components compile and render.

### Composition root (target shape of `page.tsx`)

```tsx
export default function HomePage() {
  return (
    <>
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
    </>
  );
}
```

Target: under 30 lines, zero JSX besides composition.

## 9. Validation gates

These are the hard gates the implementation plan must pass before the PR can merge:

1. **Build is green:** `next build` with zero TypeScript errors and zero new lint warnings.
2. **Visual parity at 1440px:** rendered page matches `landing-v5-preview.html` within reasonable tolerance — same beats, same density rhythm, same gradients, same motion. Spot-checked side-by-side.
3. **Mobile parity at 360 / 414 / 768:**
   - 360px (iPhone SE) — every section legible, no horizontal scroll, all CTAs reachable, hero headline ≤ 4 lines, AI Flow particles still animating, insight feed showing 1 card, carousel swipeable, trust band stacking cleanly.
   - 414px (iPhone 14 Pro Max) — same as 360 but with the type one step larger.
   - 768px (iPad portrait) — capability grid 2×3, trust band 2×3, AI Flow narrative 2×2.
4. **Touch targets:** every interactive element ≥44×44px hit area on a touch device. Quick spot check via DevTools touch emulation.
5. **`prefers-reduced-motion`:** with the OS toggle on, NetworkCanvas hides, BlobBackground stops animating, orb pulse stops, insight feed becomes static, carousel transitions become instant.
6. **Lighthouse mobile (Moto G Power, 4G):** Performance ≥ 85, Accessibility ≥ 95, Best Practices ≥ 95. SEO unmeasured for now.
7. **Accessibility:** keyboard tab order is sane (nav → hero CTAs → AI Flow → grid → carousel → trust → form → footer). Every focusable element has a visible focus ring. Insight feed announces rotations via `aria-live` without hijacking focus.
8. **Sign-in still works:** the extracted Navbar dropdown still authenticates against NextAuth credentials provider end-to-end. Test with a real seeded user.
9. **Contact form still works:** still POSTs to `/api/contact` and shows the existing success/error states.
10. **No dead code:** `PartnerScroll`, old `Features`, old `AgentSection`, old `Security`, dead CSS classes all removed.

## 10. Out of scope (explicit)

- Real product screenshots for the carousel — v1 ships with styled CSS/SVG mockups. Real PNGs are a follow-up.
- Partner / customer logo strip — vetoed.
- Any change to `/api/contact`, `/api/auth/check-verified`, `middleware.ts`, or NextAuth config.
- Installing `framer-motion` — all motion is CSS keyframes + SVG `offset-path`. Already confirmed not in deps.
- Testimonial carousel, autoplay on the feature carousel, scroll-linked parallax, AI sparkle/shimmer effects.
- Background video (no asset).
- Re-introducing General Sans or any non-Inter typeface.
- Re-introducing eyebrow labels or floating metric pills.
- Re-introducing the orbital diagram, free-floating chip orbs, or any glass/frosted/translucent material.
- The "Vantor" prefix on capability cards.
- Changing insights 1–3 — those are locked, only 4 and 5 were ever in flux and are now also locked.

## 11. Open questions for review

None at the design-framing stage. All seven design decisions from session 1+2 are locked in memory. If the user spots a contradiction with the v5.6 mockup during review, the spec is the source of truth and the mockup will be patched to match.

The two things that **could** still slip during implementation:

- **AI Flow vertical SVG paths on mobile** — if reflowing the `offset-path` particle animation is genuinely hard, fall back to the simplified mobile layout described in §7.2 (single beam between input/output grids and the orb). The decision is mine to make at implementation time as long as the "particles still run on mobile" intent is preserved.
- **NetworkCanvas density tuning** — particle counts in §7.5 are starting points. If real-device profiling shows them too aggressive, halve them. If mobile holds 60fps comfortably, stay there.

Both are implementation tactics, not design decisions.

## 12. How implementation will be sequenced

The plan (next document, written via `superpowers:writing-plans`) will sequence the work roughly as:

1. Scaffold `src/components/landing/` with empty stubs and a thin `page.tsx` that composes them — verifies routing/imports.
2. Migrate Navbar verbatim, add mobile sheet, verify sign-in still works.
3. Build Hero + HeroBackdrop with the density props.
4. Build CapabilityGrid + TrustBand (the two simple "scenery" sections — get them out of the way).
5. Build FeatureCarousel including swipe.
6. Build AIFlow + AIFlowDiagram + InsightFeed — the headline beat. This is the highest-risk task, sequenced last so the rest of the page is already proven.
7. Migrate ContactForm + Footer.
8. Add color tokens to `globals.css`, purge dead classes, run Lighthouse, fix anything below the score floor.
9. Delete the obsolete components in their own commits.
10. Final mobile audit at 360 / 414 / 768 / 1024 / 1440 / 1920.

Each step is independently testable. If step 6 turns out harder than expected, steps 1–5 already give us a shippable refresh that just lacks the headline beat.
