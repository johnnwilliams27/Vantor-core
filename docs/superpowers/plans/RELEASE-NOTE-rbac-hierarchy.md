# Release Note — RBAC Hierarchy

**Branch:** `feature/rbac-hierarchy`
**Target:** master
**Migration:** `0049_rbac_hierarchy.sql` (additive; includes an `UPDATE` on existing user_profiles — see below)

## TL;DR for users

We've rebuilt how roles and approvals work in Vantor. Three visible changes:

1. **New `Executive` role.** Sits between Treasury Manager and Enterprise Admin. Approves high-value transfers ($1M+) but doesn't author policies.
2. **Enterprise Admin now has strict separation of duties.** Admins author policies but **cannot approve transfers** under them. The approval workflow will return a specific error (`enterprise_admin_cannot_approve`) if an admin tries.
3. **Treasury Managers no longer author policies.** Policy authoring, activation, hard-limit edits, and RBAC settings are now reserved to Enterprise Admins.

## For existing users — automatic upgrades

If you were relying on the `is_policy_admin=true` flag to author policies (e.g. you were a Treasury Manager with that flag set), **migration 0049 automatically upgrades you to the Enterprise Admin role** so you don't lose power. Dev preview shows zero affected users; prod preview will run as part of the migration and log the count.

If you were a Treasury Manager WITHOUT the flag and you were trying to author: you'll see a new error ("This action requires the enterprise_admin role") the first time you click Create Draft or Edit Rule. Ask your Enterprise Admin to promote you in Settings → Team.

## New surfaces

### Account Management (`/settings/accounts`)
- **RBAC Settings card at the top** — toggle "Author-approver separation" (default: strict). Enterprise Admins only.
- **Role picker** shows a ⚡ "no approvals" badge on Enterprise Admin so you know about the strict-SoD constraint up front.
- **Permission map** rebuilt — 22 capabilities × 5 roles. Clearer split of "Initiate" (Treasury Manager) vs "Approve" (tier-based) vs "Author" (Admin only).
- **Role change persistence bug fixed.** Before this release, changing a team member's role in the UI didn't persist — refresh reverted it. Now writes through a new `PATCH /api/user/enterprise/team/[userId]` endpoint with audit logging.

### New default approval ladder ($50K / $500K / $1M)
Seeded via `scripts/seed-default-approval-ladder.ts`. Idempotent — won't overwrite an existing active policy. For any enterprise without an active policy:
- **$50K+** → require_approval, 1 slot (Treasury Manager)
- **$500K+** → require_approval, 2 slots (Treasury Manager × 2)
- **$1M+** → require_approval, 2 slots (Treasury Manager + Executive)

### Chain-size guardrails at activation
You can no longer activate a policy where a ≥$500K rule routes to a single-slot chain, or a ≥$1M rule routes to a chain with no Executive slot. Error copy points you to the specific rule + chain and the concrete fix.

### `enterprise_rbac_settings` table
One row per enterprise with the `author_approver_separation_enabled` toggle. Default true. Backfilled on first touch — no explicit migration pass needed.

## Deprecations (follow-up PR, 1–2 week window)

The `user_profiles.is_policy_admin` column is **no longer read** by any gate, but stays in the schema for rollback safety. A follow-up migration will drop it after a 1–2 week window.

## What's NOT covered here

- **Invite flow and remove flow.** Both also mutate only local UI state (same class of bug as the role change we fixed). Out of RBAC scope — tracked for a separate cleanup PR.
- **Pre-merge outreach.** Per direction, no Slack/email blast before merge — users discover on next login. If any existing Treasury Manager loses authoring, their next click produces a clear error message pointing them to the fix.
- **Prod migration.** `0049_rbac_hierarchy.sql` was applied to dev only. Prod migration happens post-merge: `npx tsx scripts/migrate.ts supabase/migrations/0049_rbac_hierarchy.sql` against the prod project ref.

## Test surface

- 705 tests pass
- 0 tsc errors
- Unit: `roles.ts`, `rbac-settings.ts`, `sod.ts`, `permissions.ts`, `satisfiability.ts`, `validation.ts`, `default-ladder.ts`
- Integration: authoring service end-to-end, approval workflow end-to-end
- Dev migration applied and verified

## File-by-file changelog

| Area | Files |
|---|---|
| Roles source of truth | `src/lib/auth/roles.ts` (new) |
| Settings persistence | `src/lib/auth/rbac-settings.ts` (new), `/api/enterprise/rbac-settings/route.ts` (new) |
| SoD runtime | `src/lib/policy/approvals/sod.ts` (aligned, configurable) |
| Authoring gates | `src/lib/policy/authoring/permissions.ts` (rewrite) |
| Satisfiability | `src/lib/policy/authoring/satisfiability.ts` (explicit distinct-user) |
| Chain guardrails | `src/lib/policy/authoring/validation.ts` (new `validateChainSizeGuardrails`) |
| Seed ladder | `src/lib/policy/seed/default-ladder.ts` (new), `scripts/seed-default-approval-ladder.ts` (new) |
| Role change API | `src/app/api/user/enterprise/team/[userId]/route.ts` (new) |
| UI | `src/app/(app)/settings/accounts/page.tsx` (rebuilt RBAC settings card, role picker, permission map) |
| Migration | `supabase/migrations/0049_rbac_hierarchy.sql` (new) |
| Plan + release note | `docs/superpowers/plans/2026-04-12-rbac-hierarchy.md`, this file |
