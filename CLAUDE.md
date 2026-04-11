# CLAUDE.md — Vantor (crypto-treasury)

## Worktree discipline (read this first)

**Never do feature work in the main checkout at `C:\Users\John\crypto-treasury`.** The main checkout is reserved for merging, releasing, and reading state. All feature work — new files, edits, commits — must happen in a worktree under `.worktrees/<short-name>/` on a dedicated `feature/<name>` branch.

**Why:** Multiple Claude Code sessions can be open against this repo at the same time. Git's index (`.git/index`) is a single shared file, so two sessions both running `git add` in the same working tree will pool their staged files into one commit — the first `git commit` sweeps up everything, under whichever message it was given, destroying the other session's intent. See the 2026-04-10 incident where a forgot-password commit was absorbed into a transfers commit.

### Starting new work — required sequence

Before touching any file in this repo, run:

```bash
# 1. confirm you're not already in a worktree (pwd should NOT contain .worktrees/)
pwd
git worktree list

# 2. from the main checkout, spin up a worktree for your task
cd /c/Users/John/crypto-treasury
git worktree add .worktrees/<short-name> -b feature/<name>

# 3. move your working directory into the new worktree and do ALL work there
cd .worktrees/<short-name>
```

Short-name conventions:
- Use kebab-case, feature-focused: `forgot-password`, `intl-banking`, `policy-engine`
- Match the branch name after the `feature/` prefix

### If you started in the main checkout by accident

If you've already made uncommitted changes in the main checkout, migrate them before committing:

```bash
# from the main checkout, with uncommitted changes
git stash push -u -m "migrate to worktree"
git worktree add .worktrees/<short-name> -b feature/<name>
cd .worktrees/<short-name>
git stash pop
```

Do this **before** running `git add` — do not try to commit from the main checkout and then "clean up" later.

### Finishing work

When the feature is ready:

```bash
# from your worktree
git push origin feature/<name>

# create a PR, or fast-forward master locally
cd /c/Users/John/crypto-treasury
git merge --ff-only feature/<name>   # or merge through GitHub
git worktree remove .worktrees/<short-name>
git branch -d feature/<name>         # after merge
```

Worktree directories live under `.worktrees/` which is gitignored — they never appear in the tree.

## Project facts

- **Stack:** Next.js 14 App Router, NextAuth v4 (JWT, no adapter), Supabase, wagmi/RainbowKit, @solana/wallet-adapter, Tailwind
- **Deploy:** Vercel (vantor-xyz project) — pushing to `master` auto-deploys to https://www.vantor.xyz
- **Supabase:** two projects — dev (`spllxotyxipdvfpkkvgu`) and prod (`lfujbwemavgiifkltrag`). Migrations must be applied to both; see `supabase/migrations/` and the memory note on Supabase instances.
- **Email:** Resend. `sendEmail()` at `src/lib/email/send.ts`. Templates in `src/lib/email/templates/`.
- **Auth middleware:** `src/middleware.ts`. Public routes live in the `PUBLIC_PATHS` array — add new unauthenticated pages there or they'll redirect to `/login`.

## Migrations

- **Apply tool:** `npx tsx scripts/migrate.ts supabase/migrations/<file>.sql`. POSTs the SQL to the Supabase Management API. Swap `NEXT_PUBLIC_SUPABASE_URL` between dev and prod project refs to target each instance. Apply to dev first, verify, then prod.
- **Tracker — cutover at 2026-04-11:** `supabase_migrations.schema_migrations` is **only authoritative for migrations applied on or after 2026-04-11**. Everything before that line was applied through `migrate.ts` without writing tracker rows, so the tracker is missing ~25 historical migrations and contains two stale `version → filename` mappings (`00071`, `00121`) from a prior renumber. **Do not trust the tracker for anything before 2026-04-11**, and do not backfill — the historical state is the on-disk migration files plus the live schema, not the tracker.
- **Going forward:** `migrate.ts` writes a tracker row (`version`, `name`, `statements`) on every successful apply, idempotent via `WHERE NOT EXISTS`. If the tracker insert ever fails, the script logs a warning but exits 0 — the migration itself already applied. Patch the missing row by hand if it matters.
