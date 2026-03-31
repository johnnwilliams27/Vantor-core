# Deployment Pipeline Design

## Overview

Three-environment deployment pipeline: localhost → dev.vantor.xyz → vantor.xyz. Each environment is fully isolated with its own database and service keys. Dev is IP-restricted.

## Git Branching

- `master` — production. Auto-deploys to vantor.xyz
- `dev` — staging. Auto-deploys to dev.vantor.xyz
- `feature/*` — feature work. PRs into `dev`

**Flow:** `feature/xyz` → PR → `dev` (deploys dev.vantor.xyz) → PR → `master` (deploys vantor.xyz)

## Vercel Projects

### Existing: `crypto-treasury` (production)
- **Branch:** `master`
- **Domain:** vantor.xyz, www.vantor.xyz
- **Env vars:** Production Supabase (lfujbwemavgiifkltrag), live Stripe keys, production Sentry DSN, `ENABLE_CRONS=true`

### New: `vantor-dev` (staging)
- **Branch:** `dev` (set as the project's production branch)
- **Domain:** dev.vantor.xyz
- **Repo:** Same GitHub repo (johnnwilliams27/Vantor-core)
- **Env vars:** Dev Supabase (spllxotyxipdvfpkkvgu), test Stripe keys, Sentry disabled, `ENABLE_CRONS` not set, `ALLOWED_IPS` set

## Environment Variables — vantor-dev

| Variable | Value | Notes |
|---|---|---|
| `NEXTAUTH_URL` | `https://dev.vantor.xyz` | |
| `NEXTAUTH_SECRET` | Same as production | Shared for now |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://spllxotyxipdvfpkkvgu.supabase.co` | Dev project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev anon key | |
| `SUPABASE_SERVICE_ROLE_KEY` | Dev service role key | |
| `STRIPE_SECRET_KEY` | `sk_test_*` | Test mode |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_*` | Test mode |
| `STRIPE_PRICE_STARTER` | Test price ID | |
| `STRIPE_PRICE_GROWTH` | Test price ID | |
| `STRIPE_PRICE_SCALE` | Test price ID | |
| `STRIPE_PRICE_ENTERPRISE` | Test price ID | |
| `STRIPE_PRODUCT_ENTERPRISE` | Test product ID | |
| `STRIPE_WEBHOOK_SECRET` | (empty or dev-specific) | |
| `PERSONA_API_KEY` | Sandbox key | |
| `PERSONA_KYC_TEMPLATE_ID` | Sandbox template | |
| `NEXT_PUBLIC_PERSONA_ENVIRONMENT` | `sandbox` | |
| `RESEND_API_KEY` | Same as production | Real emails for testing |
| `RESEND_USE_MOCK` | `false` | |
| `NEXT_PUBLIC_SENTRY_DSN` | (empty) | Disabled on dev |
| `ANTHROPIC_API_KEY` | Same as production | Shared |
| `ALLOWED_IPS` | Comma-separated IP allowlist | Only set on dev |
| `ENABLE_CRONS` | (not set) | Disables cron jobs |
| `ETHEREUM_RPC_URL` | Mainnet Infura | Same for now |
| `SOLANA_RPC_URL` | Mainnet Helius | Same for now |
| All `*_USE_MOCK` vars | `true` | Chainalysis, Plaid, Bridge, CoinGecko, yield, ERP |
| `CREDENTIALS_ENCRYPTION_KEY` | Same as production | |
| `SUPABASE_ACCESS_TOKEN` | Same | For migrations |

## IP Restriction

Middleware-based allowlist on dev.vantor.xyz only.

- Env var: `ALLOWED_IPS=123.45.67.89,98.76.54.32` (comma-separated)
- Check runs in `src/middleware.ts` before any other logic
- Reads client IP from `x-forwarded-for` header (standard on Vercel)
- If `ALLOWED_IPS` is set and client IP is not in the list → return 403
- If `ALLOWED_IPS` is not set → skip check (production, localhost)
- Adding a new person: add their IP in Vercel dashboard env vars, redeploy

## Cron Job Gating

Cron routes check `ENABLE_CRONS` env var before executing.

- `ENABLE_CRONS=true` set only on production Vercel project
- Each cron API route checks this var at the top; returns 200 no-op if not set
- Prevents scheduled payments, balance polling, and treasury analysis from running against dev DB

## DNS

Already configured:
- `vantor.xyz` → A record → 76.76.21.21 (Vercel)
- `www.vantor.xyz` → CNAME → cname.vercel-dns.com
- `dev.vantor.xyz` → CNAME → cname.vercel-dns.com (just added in GoDaddy)

## Implementation Steps

1. Add IP allowlist check to middleware.ts
2. Add cron gating to cron API routes
3. Create `dev` branch from current feature branch
4. Create `vantor-dev` Vercel project linked to `dev` branch
5. Configure env vars on vantor-dev
6. Add `dev.vantor.xyz` domain to vantor-dev project
7. Add `ENABLE_CRONS=true` to existing production project env vars
8. Test deployment to dev.vantor.xyz
