# Sanctions Screening Module

Counterparty-level sanctions screening using [OpenSanctions](https://www.opensanctions.org/) data. This is **complementary** to the existing Chainalysis address screening — Chainalysis screens wallet addresses, this module screens counterparty entities by name.

## Architecture

```
counterparty created ──► onboarding screen ──► cleared (transfer_eligible=true)
                                             └► flagged ──► case opened (transfer_eligible=false)
                                                            ├── analyst clears ──► transfer_eligible=true
                                                            ├── analyst escalates (stays blocked)
                                                            └── analyst blocks (permanently blocked)

weekly cron ──► re-screen all active counterparties ──► detect newly flagged ──► open cases

transfer path ──► read counterparty.transfer_eligible (local only)
               └► if stale (>14 days), inline re-screen before allowing
```

### Key Principles

1. **Sanctions risk attaches to counterparties, not transactions.** Screen entities, not payments.
2. **OpenSanctions is never a synchronous dependency of payment authorization.** The transfer path reads local screening state only. The only exception is the staleness fallback (configurable, default 14 days).
3. **Three screening moments:** onboarding, weekly batch, staleness fallback.
4. **Append-only audit trail.** `case_actions` table enforced at the DB layer — UPDATE and DELETE trigger exceptions.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript types, domain enums, config |
| `client.ts` | OpenSanctions API client + factory |
| `mock-client.ts` | Mock client for dev/testing |
| `onboarding.ts` | Screen counterparty at creation |
| `rescreen.ts` | Weekly batch re-screening |
| `eligibility.ts` | Pre-transfer eligibility check |
| `cases.ts` | Case actions (clear, escalate, block, reassign, note) |
| `lookup.ts` | Ad-hoc name search |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSANCTIONS_API_URL` | `https://api.opensanctions.org` | API base URL. Use `http://localhost:9090` for local yente. |
| `OPENSANCTIONS_API_KEY` | — | API key. Required for hosted API. |
| `OPENSANCTIONS_USE_MOCK` | `false` | Use mock client (also triggered by `FORCE_MOCK=true`). |
| `OPENSANCTIONS_MATCH_THRESHOLD` | `0.7` | Score threshold for flagging a counterparty (0-1). |
| `OPENSANCTIONS_STALENESS_DAYS` | `14` | Days before a screening is considered stale for transfer eligibility. |

## Local Development with yente

[yente](https://github.com/opensanctions/yente) is the self-hosted OpenSanctions API.

```bash
docker run -p 9090:8000 ghcr.io/opensanctions/yente
```

Then set in `.env.local`:
```
OPENSANCTIONS_API_URL=http://localhost:9090
OPENSANCTIONS_USE_MOCK=false
```

## Running the Weekly Re-screen Locally

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/rescreen-counterparties
```

The job processes up to 1000 counterparties per run (20 batches of 50). It skips test enterprises and counterparties that were screened within the last 7 days.

## Case State Machine

```
open ──► cleared (terminal)
open ──► blocked (terminal)
```

Actions: `clear` (with reason code), `block`, `note`.

Clear reason codes: `false_positive_name_similarity`, `false_positive_different_entity`, `verified_not_match`, `other`.

## API Budget

At $0.12/call with 25k calls/month:
- Weekly re-screen of 500 counterparties = ~2,150 calls/month
- Budget supports up to ~5,800 active counterparties with weekly re-screening
