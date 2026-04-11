# Vantor – Autonomous Stablecoin Treasury Management

AI-driven liquidity management for USDC and USDT treasury operations on Ethereum and Solana in conjunction with fiat currency. Integrates with ERP systems (SAP, Oracle, Xero, NetSuite), supports on-ramps & off-ramps, real-time and scheduled payments, token swaps, invoice management, audit trails, and role-based access control.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + Backend | Next.js 14 (App Router) + API Routes |
| Database | Supabase (PostgreSQL + Realtime) |
| Auth | NextAuth.js v4 + Supabase adapter |
| Styling | Tailwind CSS + custom UI components |
| Charts | Recharts |
| State | Zustand + TanStack Query |
| ETH wallet | wagmi v2 + viem + RainbowKit |
| SOL wallet | @solana/wallet-adapter-react |
| Swap (ETH) | 1inch Fusion API |
| Swap (SOL) | Jupiter Aggregator V6 API |
| Deployment | Vercel + Supabase |

## Quick Start

### 1. Clone and install

```bash
cd crypto-treasury
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
# Fill in all required values
```

### 3. Set up Supabase

```bash
# Run migrations in your Supabase dashboard SQL editor, in order:
# supabase/migrations/0001_init_schema.sql
# supabase/migrations/0002_rls_policies.sql
# supabase/migrations/0003_seed_dev.sql  (dev only)
```

### 4. Start dev server

```bash
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXTAUTH_URL` | Yes | App URL (http://localhost:3000 in dev) |
| `NEXTAUTH_SECRET` | Yes | Random 32+ char secret |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server only) |
| `ETHEREUM_RPC_URL` | Yes | Infura/Alchemy Ethereum RPC |
| `SOLANA_RPC_URL` | Yes | Helius Solana RPC |
| `ETHERSCAN_API_KEY` | Yes | For ETH transaction history |
| `HELIUS_API_KEY` | Yes | For Solana transaction history |
| `ONEINCH_API_KEY` | Yes | For Ethereum token swaps |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Yes | WalletConnect project ID |
| `CRON_SECRET` | Yes | Secret for cron job authentication |
| `ERP_USE_MOCK` | Yes | Set to `true` for mock ERP |
| `CREDENTIALS_ENCRYPTION_KEY` | Yes | 32-byte hex key for ERP credential encryption |

## User Roles

| Role | Permissions |
|---|---|
| `auditor` | Read-only access to all data |
| `accountant` | + Write invoices, sync ERP, GL posting |
| `treasury_manager` | Full access including payments and swaps |

New users are assigned `auditor` role by default. A treasury_manager can upgrade roles directly in the database.

## Architecture

### RBAC (3 layers)

1. **Edge middleware** (`src/middleware.ts`): Route-level check before handler runs
2. **API route** (`requireRole()`): Defense-in-depth in every API handler
3. **Supabase RLS**: Database-level enforcement

### ERP Mock → Real Swap

All ERP logic routes through `IERPAdapter` interface → `factory.ts`:
- Set `ERP_USE_MOCK=true` to use mock SAP/Oracle adapters (default)
- Set `ERP_USE_MOCK=false` + implement `SAPRealAdapter`/`OracleRealAdapter` to go live

### Scheduled Payments

Vercel Cron (`* * * * *`) fires `/api/cron/process-scheduled-payments`:
- Finds `payments` where `status='pending' AND scheduled_for <= NOW()`
- Marks `status='processing'` (prevents double-execution)
- Executes max 50 per tick

### Real-Time Balances

1. Cron (`*/5 * * * *`) polls ETH/SOL RPC → writes to `wallet_balances`
2. Supabase Realtime pushes DB changes to browser via WebSocket
3. TanStack Query cache updated in-place

## Project Structure

```
src/
├── app/
│   ├── (auth)/login|register/     # Public auth pages
│   ├── (app)/                      # Protected app pages
│   │   ├── dashboard/
│   │   ├── wallets/
│   │   ├── invoices/
│   │   ├── payments/
│   │   ├── swaps/
│   │   ├── transactions/
│   │   ├── audit/
│   │   └── settings/erp/
│   ├── setup/                      # Onboarding wizard
│   └── api/                        # API routes
├── components/
│   ├── ui/                         # Base UI components
│   ├── layout/                     # AppShell, Sidebar, Topbar
│   ├── auth/                       # LoginForm, RegisterForm, RoleGate
│   ├── wallets/                    # ETH + SOL wallet connect
│   ├── balances/                   # Balance summary
│   ├── invoices/                   # Invoice table + sync
│   ├── payments/                   # Send + schedule forms
│   ├── swaps/                      # Swap form + quote display
│   ├── charts/                     # Recharts components
│   ├── audit/                      # Audit trail table
│   └── setup/                      # Onboarding wizard
├── lib/
│   ├── supabase/                   # client.ts, server.ts, admin.ts
│   ├── auth/                       # nextauth.config, rbac.ts
│   ├── blockchain/
│   │   ├── ethereum/               # balances, transfer, history
│   │   └── solana/                 # balances, transfer, history
│   ├── erp/
│   │   ├── interface.ts
│   │   ├── factory.ts
│   │   └── mock/                   # SAP + Oracle mocks
│   ├── swaps/                      # jupiter.ts, oneinch.ts
│   ├── payments/executor.ts
│   ├── audit/logger.ts
│   └── realtime/
├── hooks/                          # useBalances, useInvoices, useWallets
├── store/                          # Zustand stores
└── types/                          # database.ts, erp.ts, api.ts
```

## Supported Tokens

| Token | Ethereum | Solana |
|---|---|---|
| USDC | 0xA0b86991... | EPjFWdd5... |
| USDT | 0xdAC17F95... | Es9vMFrz... |

## Forecast Analytics

Cash-flow forecasting is built on three services under `src/lib/`:

- **`TreasuryStateService`** (`src/lib/treasury/state/service.ts`) —
  Aggregates bank accounts, wallet balances, DeFi positions, and
  in-flight transfers into a `TreasuryStateSnapshot` with FX rates
  captured inline for reproducibility. Persisted to
  `treasury_state_snapshots` (migration 0037).
- **`ForecastEngine`** (`src/lib/forecast/engine.ts`) — Pure
  projection math. Takes a state snapshot + obligations +
  `ScenarioParams` and returns a day-by-day `Projection` with
  `minBalance`, `shortfalls`, and a `covered` verdict. No I/O, no
  clock. Deterministic tests in `tests/forecast/engine.test.ts`.
- **`ForecastService`** (`src/lib/forecast/service.ts`) —
  Orchestrates state snapshotting, obligation expansion, scenario
  resolution, and engine invocation. Persists results to
  `forecast_snapshots` (migration 0038) with a `correlation_id` so
  downstream consumers can link their decisions back to the
  forecast they acted on. Supports hypothetical overlays via
  `svc.hypothetical([...])`.

Scenarios: `base`, `conservative`, `stress`, `custom`. Hypothetical
queries never auto-persist. Recurring obligations are materialized
nightly at 03:00 by `/api/cron/materialize-obligations`.

See [`docs/architecture/forecast-analytics.md`](docs/architecture/forecast-analytics.md)
for the full architecture note, scenario parameters, service contract,
and Phase B/C roadmap.
