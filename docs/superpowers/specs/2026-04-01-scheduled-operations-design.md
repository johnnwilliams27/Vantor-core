# Scheduled Operations: Swap, Bridge, Ramp

**Date:** 2026-04-01
**Status:** Approved

## Overview

Extend Vantor's money movement capabilities with scheduling for swaps, bridges, and ramps. Currently only payments support scheduling. This feature adds the same capability to all three remaining operation types with a re-quote-at-execution model, tolerance-based auto-execution, and manual approval flows when rates deviate.

These scheduled operations are callable by the agentic operator for future actions based on cash flow, AR/AP, treasury reserves (fiat/stable), and invoices.

## Tolerance Thresholds

| Operation | Max Deviation (bps) | Rationale |
|-----------|---------------------|-----------|
| Swap (USDC/USDT) | 10 | Stablecoin pairs should be near 1:1 |
| Bridge (cross-chain) | 25 | Same token, but gas/bridge fees fluctuate |
| Ramp (fiat/crypto) | 50 | FX rates and provider spreads move more |

If re-quote at execution time exceeds the tolerance vs the initial quote, the operation requires manual user authorization.

## Execution Flow

```
Scheduled time arrives (cron, every 5 minutes)
  -> Re-quote via banking adapter
  -> Calculate deviation vs initial_quote
  -> Within tolerance?
     YES -> Auto-execute -> Write to transaction table -> status: completed
     NO  -> status: awaiting_authorization, expires_at = NOW() + 24h
         -> Notify user (in-app + Slack if connected)
         -> User opens approval modal -> sees fresh live rate vs original
         -> Approve -> execute at current market rate
         -> Deny -> status: cancelled
         -> 24 hours pass -> status: expired, notify user
```

When a user manually approves, the system fetches one final fresh quote and executes immediately. No approval loops -- the manual approval is the authorization to execute at market rate.

## Database

### New Table: `scheduled_operations`

```sql
CREATE TABLE scheduled_operations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id     UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('swap', 'bridge', 'ramp')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'awaiting_authorization', 'completed', 'failed', 'cancelled', 'expired')),
  scheduled_for     TIMESTAMPTZ NOT NULL,
  params            JSONB NOT NULL,
  initial_quote     JSONB NOT NULL,
  execution_quote   JSONB,
  deviation_bps     INTEGER,
  tolerance_bps     INTEGER NOT NULL,
  executed_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  tx_hash           TEXT,
  error_message     TEXT,
  memo              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_ops_pending
  ON scheduled_operations(status, scheduled_for)
  WHERE status = 'pending' AND scheduled_for IS NOT NULL;

CREATE INDEX idx_scheduled_ops_expiring
  ON scheduled_operations(status, expires_at)
  WHERE status = 'awaiting_authorization' AND expires_at IS NOT NULL;
```

### Transaction Table Additions

Add to `swaps`, `bridge_transfers`, and `fiat_transactions`:

```sql
ALTER TABLE swaps ADD COLUMN scheduled_operation_id UUID REFERENCES scheduled_operations(id);
ALTER TABLE swaps ADD COLUMN scheduled_metadata JSONB;

ALTER TABLE bridge_transfers ADD COLUMN scheduled_operation_id UUID REFERENCES scheduled_operations(id);
ALTER TABLE bridge_transfers ADD COLUMN scheduled_metadata JSONB;

ALTER TABLE fiat_transactions ADD COLUMN scheduled_operation_id UUID REFERENCES scheduled_operations(id);
ALTER TABLE fiat_transactions ADD COLUMN scheduled_metadata JSONB;
```

`scheduled_metadata` stores: `{ original_rate, executed_rate, deviation_bps, scheduled_for }`.

### Params JSONB Structure (by type)

**Swap:**
```json
{
  "walletId": "uuid",
  "chain": "ethereum",
  "fromToken": "USDC",
  "toToken": "USDT",
  "amount": "10000",
  "slippageBps": 50
}
```

**Bridge:**
```json
{
  "fromWalletId": "uuid",
  "toWalletId": "uuid",
  "token": "USDC",
  "amount": "10000",
  "fromChain": "ethereum",
  "toChain": "solana"
}
```

**Ramp:**
```json
{
  "direction": "onramp",
  "cryptoToken": "USDC",
  "fiatCurrency": "USD",
  "cryptoAmount": "10000",
  "bankAccountRef": "uuid",
  "walletId": "uuid"
}
```

## API Routes

### New Endpoints

| Method | Route | Purpose | Role |
|--------|-------|---------|------|
| GET | `/api/scheduled-operations` | List scheduled operations (filterable by type, status) | accountant+ |
| POST | `/api/scheduled-operations` | Create a scheduled operation | treasury_manager |
| GET | `/api/scheduled-operations/[id]` | Get single operation details | treasury_manager |
| DELETE | `/api/scheduled-operations/[id]` | Cancel pending/awaiting operation | treasury_manager |
| POST | `/api/scheduled-operations/[id]/approve` | Approve awaiting operation (fetches fresh quote, executes) | treasury_manager |

### POST `/api/scheduled-operations` Flow

1. Validate params with Zod (type-specific schemas)
2. Fetch initial quote via banking adapter
3. Set `tolerance_bps` based on type (10/25/50)
4. Insert row with status `pending`
5. Audit log: `scheduled_operation_create`
6. Return the created operation with quote details

### POST `/api/scheduled-operations/[id]/approve` Flow

1. Verify status is `awaiting_authorization` and not expired
2. Fetch fresh quote via banking adapter
3. Execute via adapter
4. Write to transaction table (`swaps`/`bridge_transfers`/`fiat_transactions`) with `scheduled_operation_id` and `scheduled_metadata`
5. Update scheduled operation: status `completed`, `execution_quote`, `executed_at`, `tx_hash`
6. Audit log: `scheduled_operation_approve`

### DELETE `/api/scheduled-operations/[id]` Flow

1. Verify status is `pending` or `awaiting_authorization`
2. Set status to `cancelled`
3. Audit log: `scheduled_operation_cancel`

### New Cron: `/api/cron/process-scheduled-operations`

Added to `vercel.json` on 5-minute interval.

**Processing loop:**
1. Query `pending` operations where `scheduled_for <= NOW()`, exclude test enterprises, batch size 50
2. For each: re-quote, compare deviation, auto-execute or flag
3. Query `awaiting_authorization` operations where `expires_at <= NOW()`
4. For each: set status `expired`, notify user (in-app + Slack)

## UI Components

### Scheduling Forms

New components mirroring existing immediate execution forms:

| Component | Mirrors | Page |
|-----------|---------|------|
| `ScheduleSwapForm.tsx` | `SwapForm.tsx` | `/swaps` |
| `ScheduleBridgeForm.tsx` | `ChainSwapForm.tsx` | `/bridges` |
| `ScheduleRampForm.tsx` | `RampForm.tsx` | `/ramps` |

Each form:
- Same fields as the immediate form + datetime picker + memo
- On submit: fetches a quote, shows the user the quoted rate and applicable tolerance
- Displays: "Auto-executes within Xbps of this rate"
- Posts to `POST /api/scheduled-operations`

Layout: Two-card grid per page (immediate left, schedule right), history table below. Matches the existing payments page layout.

### AI Approvals (Dashboard)

**Rename "AI Recommendations" to "AI Approvals"** on the dashboard.

This section contains:
- Existing AI recommendations (unchanged content)
- Scheduled operation approvals (new)

**Inline card behavior:**
- Shows: type badge, summary line, timestamp, status
- Single **"Review"** button -- no approve/deny at this level
- After action taken: "Review" replaced with status badge ("Approved" in green / "Denied" in red) with timestamp
- Resolved items remain visible in the list (filterable)

**ApprovalModal (shared):**
- Opens on "Review" click
- Same modal shell for both AI recommendations and scheduled operation approvals
- **For AI recommendations:** reasoning, impact analysis, approve/deny
- **For scheduled operations:** original params, original rate vs current live rate (fetched on modal open), deviation in bps (color-coded), approve/deny, "Expires in X hours" countdown
- On approve: modal closes, inline card shows "Approved" badge
- On deny: modal closes, inline card shows "Denied" badge

### Topbar Notifications

- Notification bell badge count includes pending approvals
- Dropdown lists pending items with type icon and summary
- Clicking any notification opens the same `ApprovalModal`

## Slack Integration

Uses existing Slack infrastructure (`postRecommendationToSlack`, `postEphemeralConfirmation`, callback handler).

### Two-Step Approval Flow

**Step 1 -- Alert** (posted when operation moves to `awaiting_authorization`):
- Message content: operation type, original rate, re-quoted rate, deviation, tolerance
- "This scheduled [swap/bridge/ramp] exceeded the [10/25/50]bps auto-execution tolerance"
- Buttons: **"Review & Approve"** / **"Deny"**

**Step 2 -- Ephemeral Confirmation** (on "Review & Approve" click):
- Callback fetches fresh quote
- Posts ephemeral message (only visible to clicking user): current live rate vs original, delta
- Buttons: **"Confirm Execute"** / **"Cancel"**

**Step 3 -- Execution** (on "Confirm Execute"):
- Executes at current market rate
- Posts channel message: "Scheduled [swap] executed -- [details]"

**On Deny/Cancel:** Sets status to `cancelled`, posts "Scheduled [swap] cancelled by @user"

**On Expiry (24h):** Posts "Scheduled [swap] expired -- no action taken within 24 hours"

## Agent Integration

### New Agent Tools

| Tool | Description | Role |
|------|-------------|------|
| `schedule_swap` | Schedule a future token swap with quote snapshot | treasury_manager |
| `schedule_bridge` | Schedule a future cross-chain bridge with quote snapshot | treasury_manager |
| `schedule_ramp` | Schedule a future on/off-ramp with quote snapshot | treasury_manager |
| `get_scheduled_operations` | List pending/awaiting scheduled operations | treasury_manager |
| `cancel_scheduled_operation` | Cancel a pending or awaiting operation by ID | treasury_manager |
| `approve_scheduled_operation` | Approve an awaiting_authorization operation by ID | treasury_manager |

### Tool Input Schemas

Each scheduling tool takes the same params as the immediate execution tool plus `scheduledFor` (ISO timestamp) and optional `memo`.

### System Prompt Updates

Update agent context to:
- Inform the agent it can schedule future swaps/bridges/ramps
- Agent can proactively suggest scheduling based on cash flow, AR/AP, treasury reserves, invoices
- Agent can surface pending approvals conversationally
- $10k+ confirmation rule applies to scheduled operations

### Existing Tools Unchanged

`execute_swap`, `execute_ramp`, `get_swap_quote`, `get_ramp_quote` remain as immediate operations.

## Audit Actions

New audit actions to add to the `AuditAction` type:

- `scheduled_operation_create`
- `scheduled_operation_approve`
- `scheduled_operation_cancel`
- `scheduled_operation_expire`
- `scheduled_operation_execute` (auto-executed within tolerance)
- `scheduled_operation_deviation` (flagged for manual approval)

## Cancellation Rules

- Only `pending` or `awaiting_authorization` operations can be cancelled
- User can cancel via: UI (cancel button on card/modal), agent tool, API endpoint
- Auto-expiry after 24 hours for `awaiting_authorization` uses status `expired` (distinct from user `cancelled`)
- Cancelled/expired operations remain in history for audit trail
