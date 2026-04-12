# Linked Accounts — Design Audit & Top 50 Recommendations

**Date:** 2026-04-12
**Branch:** feature/landing-refresh
**Pages audited:**
- `/wallets` — `src/app/(app)/wallets/page.tsx`
- `/bank-accounts` — `src/app/(app)/bank-accounts/page.tsx` → `src/components/banking/BankAccountsTab.tsx`
- `/settings/erp` — `src/app/(app)/settings/erp/page.tsx`
- `/settings/integrations` — `src/app/(app)/settings/integrations/page.tsx`

**Lens:** frontend-design + design-review + web-interface-guidelines + ui-ux-pro-max

---

## First impression (one paragraph, per page)

**Wallets.** The 2-up link-card grid reads as two half-empty buckets — a single unstyled default-teal button sits on each card with no supporting content, no logos, no value prop. The table below is actually the strongest surface in the whole section: inline nickname edit, per-row copy, expand-to-full-address, balance breakdown. But the status column (checkmark / clock) has no legend, so the best column in the product silently gates comprehension.

**Bank Accounts.** Two stacked full-width buttons dominate the top ("Connect" + "Add Manually Instead") with no visual weighting. Manual entry is a one-way door — no back button inside the form once you open it. "Verified" vs "Manual" is well-represented via Badge variants, but again no legend explains why they differ. And since manual entry can't pull balances, it's an ornamental flow — a data-entry dead-end disguised as connectivity.

**ERP.** The hardcoded dropdown lists "SAP Digital Currency Hub" (a product, not the provider) and omits QuickBooks entirely. Per-provider fields (Company Code, Tenant ID, Account ID) are all visible simultaneously with parenthetical "(SAP)" / "(Oracle/Xero)" labels — users scan a field wall they can't pattern-match. The pricing up-sell modal is hand-rolled as a raw `<div>` overlay instead of `<Dialog>`. Linked systems render as stacked `<div>` rows, not the Table used elsewhere, so two sibling pages (Wallets, Bank Accounts) and this one tell users three different stories about "list of linked things."

**External Integrations.** One card, one provider (Slack), no logo. The page title says "Integrations" (plural) but the scaffolding doesn't hint at what's next. Connect Slack button is bare teal primary with no Slack mark, so the connection moment is cold. Setup instructions are a numbered list with the callback URL rendered inline — functional but not designed.

---

## Cross-cutting verdicts

- **Design Score (current): C+** — fundamentals are in place (Cards, Badges, Table, Dialog) but the pages don't share a layout vocabulary.
- **AI Slop Score: B-** — no purple gradients, no decorative blobs, no emoji. But the "Link Wallet" card pair is the 2-column symmetric empty-card pattern on a small scale.
- **Systemic gap:** Operations pages already have `FilterBar`, `TablePagination`, `TableCardSkeleton`, `InfoTooltip`, `ConfirmDialog`, `CardError`. Linked Accounts uses **none of the first four** even though every use case applies.

---

## Top 50 Recommendations (ranked)

Ordering: P1 = high impact/visible, P2 = polish & consistency, P3 = nice-to-have. `[file:line]` cites the anchor to change.

### P1 — High impact (do these first)

1. **Rename dropdown option `SAP Digital Currency Hub` → `SAP`.** [src/app/(app)/settings/erp/page.tsx:218] Also update the `CardDescription` on line 210 and any copy referring to it. Matches memory rule on terse, exact product names.

2. **Add QuickBooks end-to-end.** Add `<option value="quickbooks">QuickBooks</option>` [erp/page.tsx:217–222], include it in the intro copy [line 210], extend the zod provider enum and the provider-specific field map (realm_id), and add a QuickBooks entry to `src/lib/erp/factory.ts`. Intro copy should become the exact list: `SAP, Oracle, NetSuite, Xero, QuickBooks`.

3. **Add a shared `TruncatedAddress` component** that wraps: (a) `truncateAddress(addr, 6)`, (b) click-to-expand toggle, (c) inline copy button with success toast, (d) `title` + `aria-label`. Extract from `wallets/page.tsx:155–177` into `src/components/ui/truncated-address.tsx`. This is the linchpin for items 4–5.

4. **Roll out `TruncatedAddress` to all 19 remaining sites identified:**
   - Transfers table (from/to) [src/app/(app)/transfers/page.tsx:187,189]
   - Swaps table wallet column [src/app/(app)/swaps/page.tsx:119]
   - All-Activity table [src/components/transactions/AllTab.tsx:42,50–51]
   - Bridge history [src/components/bridges/BridgeHistory.tsx:111]
   - Invoice pay modal destination preview [src/components/invoices/PayInvoiceModal.tsx:143]
   - Invoice table detail modal [src/components/invoices/InvoiceTable.tsx:386]
   - Treasury recommendation modal + card [treasury/ReviewRecommendationModal.tsx:86, RecommendationCard.tsx:114]
   - Recommendations chart card [charts/RecommendationsCard.tsx:167]
   - Dropdown walletDisplayName sites (6): yield forms x3, ramp form x2, transfer/swap/chain-swap forms — these use the truncation in `<option>` text; wrap only the "display" function, not the `<option>` value.

5. **Add status legend/tooltip to Wallet table status column.** [wallets/page.tsx:178–183] Two options — recommended: wrap the icon in `<InfoTooltip>` with content explaining "Pending: on-chain signature verification still in progress (1–2 min). Verified: ownership confirmed." Alt: add a one-line helper row above the table "⏱ Pending = awaiting signature verification · ✓ Verified = ownership confirmed."

6. **Add `aria-label` on every icon-only action button** across these pages: Pencil (edit), Trash2 (delete), Copy, X (cancel). Currently only `title="Copy address"` on the copy button; screen readers get nothing for the others. [wallets/page.tsx:130–147, 197–211; BankAccountsTab.tsx equivalents; erp/page.tsx:372]

7. **Replace the hand-rolled ERP pricing overlay with `<Dialog>`.** [erp/page.tsx:413–444] Fix: swap `<div className="fixed inset-0 z-50 …">` for `<Dialog>` + `<DialogContent>` + `<DialogHeader>` + `<DialogFooter>`. Consistency with every other modal in the app.

8. **Make ERP fields dynamic per selected provider.** [erp/page.tsx:230–263] Watch `provider` via `useForm().watch` and conditionally render the correct field set. Suggested per-provider schema:
   - **SAP:** API URL, Client ID, Client Secret, **Company Code (required)**, Landscape (dev/qa/prod)
   - **Oracle:** API URL, Client ID, Client Secret, **Tenant/Instance ID (required)**
   - **NetSuite:** Account ID (required), Consumer Key, Consumer Secret, Token ID, Token Secret (token-based auth, NOT OAuth client id)
   - **Xero:** OAuth 2.0 flow → only show "Connect with Xero" button (redirect); collect Tenant ID post-auth
   - **QuickBooks:** OAuth 2.0 flow → "Connect with Intuit" button; post-auth capture `realmId` + access/refresh tokens

   The zod schema should validate the provider-specific fields as required when that provider is selected (use `.refine()` or `z.discriminatedUnion('provider', …)`).

9. **Make the Connect Slack button branded.** [integrations/page.tsx:270–272] Replace `Connect Slack` with a Slack-branded CTA: Slack logo (SVG) + text, on the standard teal primary OR Slack's own aubergine `#4A154B` (commonly used for "Sign in with Slack"). Provide the SVG from `/public/integrations/slack.svg` (add asset). Also give the header icon a real Slack logo instead of the generic `<Plug />` [line 138].

10. **Add a visible "linked via" mini-attribution on each linked bank account.** [BankAccountsTab.tsx:165–171] Append a small label next to the institution name: "via Stripe Financial Connections" / "via Belvo" / "Manual entry". The user called out uncertainty about the manual flow — attribution makes the provenance (and its balance limitation) legible on hover via `InfoTooltip`.

11. **Decide on Manual Bank entry: either remove it or demote it + explain.** Since manual entries can't pull balances, today they're orphan rows users will distrust. Two options:
    - **Recommended:** Demote to a `<details>` or a `"Add manually"` text-link (not a full-width button), behind copy like "For read-only reference (no balance sync)." Keeps the flow for audit-trail users, removes it from the primary path.
    - Alt: remove entirely; balances are the product value.

12. **Add a Back button to the Manual Bank entry form.** [BankLinkButton.tsx around lines 161–173, ManualBankForm.tsx] Fix: render a `← Back` ghost button above the form title when `showManual=true`, and/or a `<Button variant="outline">` pair (`Cancel` + `Save`) in a `<DialogFooter>` style row. Current flow has no way out except submitting or hitting browser back.

13. **Fix the Link Wallet card "empty feeling."** [EthWalletConnect.tsx:62–127, SolWalletConnect.tsx sibling] Add to each card in the disconnected state:
    - A large chain icon/logo (Ethereum diamond, Solana color-block) at the top-left
    - A 1-line "What you get" value line: "Connect for on-chain signing + balance sync"
    - A small supported-token row: `USDC · USDT`
    - Thin divider, then the `Link Wallet` button
    - Keep the third-party modal (RainbowKit / Wallet Adapter) — we don't control those, but we control the card around them.

14. **Standardize the two "Link Wallet" buttons' styling.** [EthWalletConnect.tsx:67, SolWalletConnect.tsx sibling] Use the `btn-gradient` class pattern from payments-page CTAs (teal→cyan pill) — unless brand demands otherwise. At minimum, match each other exactly.

15. **Wrap the address column in both Wallet and Bank tables with the new `TruncatedAddress` component** (in Bank case, mask the account number behind `••••{last4}` which is already correct — but ensure clicking copies the stored stripe/plaid ID, not the masked string — or skip copy for bank accounts since users can't paste a masked number anywhere useful).

16. **Replace `CardSpinner` with `TableCardSkeleton`** for each of the 3 tables (wallets, bank accounts, ERP list). [src/components/ui/operations-skeletons.tsx is ready; just import]. Content-shaped loaders match the payments-page pattern.

17. **Convert the ERP "Linked ERP Systems" list [erp/page.tsx:305–384] into a proper `<Table>` with columns: Name · Provider · Last Synced · Status · Actions.** The inconsistency of "Wallets is a table, Bank Accounts is a table, ERP is a div stack" is the single biggest cross-page UX smell.

18. **Add empty-state illustrations (or at least a duotone lucide glyph) to all four pages.** [wallets/page.tsx:220–222, BankAccountsTab.tsx:106–108, erp/page.tsx near :304, integrations/page.tsx N/A]. Current: plain gray text. Replace with centered `Wallet`/`Landmark`/`Settings2`/`Plug` icon @ h-10 w-10 + muted text + primary CTA button repeated below ("Link Ethereum Wallet", etc.) so the empty state is itself actionable.

19. **Introduce a scaffolded integrations catalog, even with one real provider.** [integrations/page.tsx] Render the page as a grid of integration cards where only Slack is "live" and the rest are `<Badge variant="secondary">Coming soon</Badge>`. Terse list of candidates:
    - **Slack** (live)
    - **Microsoft Teams** — same use case for enterprises not on Slack
    - **Email** (SMTP / SendGrid / Resend) — daily digests, alerts
    - **Webhooks** — generic POST endpoint for custom integrations
    - **Zapier** — long tail
    - **PagerDuty / Opsgenie** — on-call for treasury alerts
    - **SFTP / S3 drop** — scheduled reporting exports
    - Keep it tight — 4 live + 4 coming-soon is a better design paradigm than 1 alone.

20. **Add logos/marks to every integration card** [integrations]. Slack, MS Teams, PagerDuty all have public brand assets. Store as SVG in `/public/integrations/`. Logo sits top-left, not `<Plug />`.

### P2 — Polish & consistency

21. **Extract the inline nickname-edit pattern** (pencil → input → check/X) into a `<NicknameEdit value onSave>` component. Currently duplicated verbatim 3× (wallets, bank accounts, ERP list). [wallets/page.tsx:114–148; BankAccountsTab.tsx:129–163; erp/page.tsx nickname block].

22. **Add `focus-visible` ring to the address expand button** [wallets/page.tsx:159–163] so keyboard users can tell where focus landed.

23. **Make the ERP "Test Connection" result an inline alert with retry + a link to provider status page** instead of plain green/red div [erp/page.tsx:265–276]. Vantor error-design feedback rule: every error needs reason code + explanation + next step + trace ID. Currently only raw API error text.

24. **Show the chain badge color consistently** — currently `<Badge variant="ethereum" | "solana">` [wallets/page.tsx:150–153], but the rest of the app uses text + icon. Keep Badge but add the chain icon (⬢ Ethereum, ☀ Solana) inside it so it scans at a glance across tables.

25. **Add a `verified_at` tooltip on the green checkmark** showing the actual timestamp ("Verified 2 days ago on Apr 10") — currently the info is in the DB but not surfaced.

26. **Normalize the delete affordance.** Today: Wallets + Bank Accounts delete is always visible; ERP delete only shows when Inactive. Choose one pattern. Recommended: always visible, but when row is Active, destructive confirm requires typing "DEACTIVATE" first.

27. **Fix the "Add Manually Instead" button copy to not use "Instead"** [BankLinkButton.tsx:82]. Instead-copy implies the primary is wrong. Better: `Add manually` (lowercase, outline button, half-width).

28. **Stack the Bank Account link buttons less flatly.** Today they're two equal full-width buttons. Give the primary provider button 100% width + primary styling; put "Add manually" as a text link below: `or add manually — no balance sync`. Reinforces P1 #11.

29. **Explicitly label the bank "Connect Bank Account" button with the provider** — `Connect via Stripe` / `Connect via Belvo` based on `bankingProvider`. Current label is generic; users can't tell what's opening.

30. **Add an `<InfoTooltip>` to `ERP Company Code`, `Tenant ID`, `Account ID`** explaining where to find them in the vendor's UI. Each ERP docs URL should also be a muted link below the label: "Where do I find this? →".

31. **Move the ERP `Test Connection` button to the right of `Save & Connect`** and make test disabled until all required fields are filled. Currently both are side-by-side with same weight [erp/page.tsx:279–284].

32. **Surface the callback URL for Slack as a field-level component** with a permanent copy affordance [integrations/page.tsx:217–221]. It currently shows copied state but doesn't persist — shows "Copy" again on re-render. Keep the checkmark for 2s, then revert — but also add a `<kbd>` style monospace background.

33. **Add a Slack bot setup link** inline ("Open api.slack.com/apps →") as a muted link above the instructions [integrations/page.tsx around :206]. The user should one-click to the right place.

34. **Give the Slack connected state a subtle workspace branding** — if `workspace_name` is known, render it next to the green checkmark: `Connected · Acme Corp workspace`. Currently the workspace name is buried inside the card body [integrations/page.tsx:148–192].

35. **Unify the loading-button copy.** Today: "Linking…" (wallets), "Connecting…" (bank, slack), "Saving…" (erp unknown). Pick one — recommended: "Connecting…" for all connect actions; "Saving…" only for edits.

36. **Use `tabular-nums` on balance columns** in both wallet and bank tables so numbers don't jitter as they update. Single Tailwind class `font-mono` alternative: `font-variant-numeric: tabular-nums`.

37. **Set `autocomplete` attributes on ERP form fields** — `autocomplete="off"` on Client Secret/API Key inputs, `autocomplete="organization"` on Nickname. Saves users from browsers autofilling irrelevant values.

38. **Enforce `type="password"` and show/hide toggle on Client Secret** [erp/page.tsx around :245]. Security + usability.

39. **Collapse "Role Permissions" matrix on `/settings/accounts`** into an expand-on-click accordion — it's 25 rows × 3 columns and dominates the page even though 95% of users will never audit it. Not part of Linked Accounts proper but adjacent — worth mentioning.

40. **Standardize the link-card header pattern.** Wallets card title is "Link Ethereum Wallet" (action verb); Bank is "Connect Bank Account" (action verb); ERP is "Link ERP System" (action verb); Integrations is "Slack" (noun only). Recommend: use `Link [thing]` or `Connect [thing]` consistently. Pick one verb, stick with it.

### P3 — Nice-to-have / future

41. **Make the Wallets 2-up grid responsive to N chains.** Today hardcoded to Ethereum + Solana. As soon as a third chain is added (Base / Polygon / etc.), the grid breaks. Convert to `flex-wrap gap-4` with each card min-width 280px. Easier future migration.

42. **Add a tiny network health indicator per chain card.** Dot + "Ethereum mainnet · healthy" or "congested" using `gas-oracle` data. Communicates live backend without clicking anything.

43. **Add a searchable wallet/bank picker** once lists exceed ~8 entries. Not urgent now (2–4 typical) but the existing `FilterBar` component drops in for ~50 lines.

44. **Add a CSV export button on each Linked Accounts table** using the existing `exportCsv` util. Treasurers will want this for audit.

45. **Add keyboard shortcut for copy on the address cell** — focus the address cell + press `C` copies. Advanced, but low effort with existing listener. `aria-keyshortcuts="C"` for discoverability.

46. **Add per-integration settings drill-down.** Once integrations >1, click-through to `/settings/integrations/slack` for detailed config (channel override per event type, test message, etc.). Today it's one flat form.

47. **Add "Last sync" freshness badge on each ERP row** — green ≤1h, amber ≤24h, red >24h. Converts the plain "Last synced: {date}" into an at-a-glance health view.

48. **Add chain-icon watermarks to the wallet card backgrounds** (very subtle, `opacity-5`). Turns the "empty" feel into something on-brand. Lucide icons work; or use chain logos.

49. **Split "Linked Accounts" sidebar group title** — consider renaming to `Connections` or `Integrations` since ERP + Slack aren't really "accounts." This also frees "Accounts" for future user/team billing work.

50. **Write an `InfoTooltip` preset for the Vantor stablecoin vocab rule.** Today random tooltips explain different things; a shared `stablecoin`/`rail` tooltip dictionary would keep copy aligned with the memory rule "always stablecoin, never crypto."

---

## Verification plan (once fixes land)

1. `/wallets` — connect an Ethereum wallet via the dev flow, verify the new `TruncatedAddress` component renders in the table, click-to-expand works, copy shows toast.
2. `/bank-accounts` — open manual form, verify Back button returns to the two-button choice without data loss.
3. `/settings/erp` — open the dropdown, confirm QuickBooks is present, SAP label is "SAP", select SAP → only SAP-specific fields appear; select Xero → only "Connect with Xero" button appears.
4. `/settings/integrations` — the page renders a grid of integration cards with Slack live and 3–4 coming-soon cards, Slack card shows the Slack logo, Connect Slack button is branded.
5. Across all operations tables — `TruncatedAddress` is the only truncation renderer (grep for remaining raw `slice(0, 6)` + `...` + `slice(-4)` patterns).
6. Re-run `/design-review` on localhost:3000 and confirm the First Impression paragraph improves per-page; AI Slop score stays B+ or better.

---

## Not in scope (flag for later)

- Real ERP adapters (SAP / Oracle / NetSuite / QuickBooks) — only Xero adapter is partially built in `.worktrees/xero-real-adapter/src/lib/erp/`. This audit is design-only; backend wiring follows.
- Replacing RainbowKit / Wallet Adapter / Stripe FC modals with Vantor-owned UI — those are third-party by necessity. We standardize the **cards around** them, not the modals themselves.
