# Yield venue category system

This module owns the canonical metadata for every yield venue Vantor
supports — DeFi lending markets, DeFi vaults, and tokenized money
market funds. It's TypeScript-only by design; venues change roughly
once a month and the set is small, so type safety via a discriminated
union is more valuable than row-level mutability.

## The three categories

| Category | Example venues | Capacity model | Regulatory wrapper |
|---|---|---|---|
| `defi_lending_market` | Aave V3, Compound V3, Kamino Lend | Pool TVL is the capacity constraint | None |
| `defi_vault` | Morpho Steakhouse, Kamino Multiply, Ondo USDY | Curated allocations; pool TVL is the cap | None (except Ondo USDY, which has KYC) |
| `tokenized_mmf` | BlackRock BUIDL, Ondo OUSG, Spiko USD | **Effectively unlimited** — backed by Treasury markets | SEC-registered, EU UCITS, Reg D 506(c), etc. |

## Key principle: "Fund Size" ≠ "TVL"

For tokenized MMFs we deliberately use the term **Fund Size / AUM**, never
**TVL**. This distinction matters: for a DeFi lending pool, TVL is a
capacity constraint — depositing more than the pool can absorb causes
slippage and utilization spikes. For a tokenized MMF, the underlying
Treasury market has effectively unlimited depth, so fund size is an
informational signal (scale, maturity, institutional adoption) rather
than a constraint.

Field names reflect this:

- `DeFiVaultMetadata.tvl` / `DeFiLendingMarketMetadata.totalSupplied` — real TVL
- `TokenizedMMFMetadata.fundSizeUsd` — AUM, informational

A future bug must not be able to accidentally compare a $2B BUIDL fund
size to a $2B Aave pool TVL as if they were the same capacity constraint.
The different field names prevent that class of mistake at compile time.

## File layout

```
src/lib/yield/venues/
├── categories.ts     ← VenueCategory, VenueStatus, VenueMetadata union
├── registry.ts       ← VENUES record — the canonical metadata for all 15 venues
├── index.ts          ← public barrel (import from '@/lib/yield/venues')
└── README.md         ← this file
```

## How to add a new venue

1. **Add the protocol ID to the Postgres enum** via a new migration:

   ```sql
   ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'my_new_venue';
   ```

2. **Add the ID to the TS union** in `src/lib/yield/interface.ts`:

   ```ts
   export type YieldProtocolId =
     | 'aave_v3'
     | ...
     | 'my_new_venue';  // ← new
   ```

3. **Add an entry to `VENUES`** in `registry.ts`. Pick the right category
   — the TypeScript discriminated union will force you to provide all
   the category-specific fields. Example for a tokenized MMF:

   ```ts
   my_new_venue: {
     id: 'my_new_venue',
     category: 'tokenized_mmf',
     displayName: 'My Fund',
     description: '...',
     chain: 'ethereum',
     supportedTokens: ['USDC'],
     status: 'coming_soon',
     riskLevel: 'low',
     riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 1 },
     kycRequired: true,
     issuer: 'My Issuer',
     fundManager: 'My Manager',
     fundSizeUsd: 500_000_000,
     underlyingComposition: 'Short-term US Treasuries',
     regulatoryWrapper: 'Reg D 506(c)',
     eligibility: 'qualified_purchaser',
     referenceYield: 0.048,
     yieldAsOf: '2026-04-11',
     currency: 'USD',
     supportedChains: ['Ethereum'],
     redemptionMechanics: 't_plus_1_daily_nav',
     timeToCash: 'T+1 daily NAV',
     reportingCadence: 'Daily NAV',
     onboardingPartner: 'Securitize',
     notes: 'One-line qualitative summary.',
   },
   ```

4. **Add the entry to all exhaustive maps** that the type checker flags:
   - `MOCK_APYS` and `YIELD_TOKENS` in `src/lib/yield/mock/yield-mock.ts`
   - `FALLBACK_TVL`, `POOL_TYPE`, `PROTOCOL_ID_TO_CACHE_SLUG` in
     `src/lib/yield/slippage/liquidity-provider.ts`
   - `PROTOCOL_LABELS` and `PROTOCOL_LOGOS` in any UI file that displays
     per-protocol data (`YieldRatesTable`, `UnifiedBalanceCard`, etc.)

5. **Run `npx tsc --noEmit`.** The exhaustive `Record<YieldProtocolId, ...>`
   types will tell you exactly which maps are missing the new entry.

6. **Run the test suite** with `npm test`. The holdings categorization
   tests iterate over every venue in the registry, so a new entry will
   automatically be covered.

## Provenance of tokenized MMF seed data

Reference yields and fund sizes were captured from rwa.xyz on
`2026-04-11` (see `MMF_YIELDS_AS_OF` in `registry.ts`). These are
7-day annualized yields, not net-of-fees.

**Refresh quarterly** against each issuer's dashboard:

| Fund | Source |
|---|---|
| BlackRock BUIDL | https://securitize.io/primary-market/buidl |
| Ondo OUSG | https://ondo.finance/ |
| Superstate USTB | https://superstate.com/ |
| Franklin BENJI | https://www.franklintempleton.com/ |
| Circle USYC | https://www.circle.com/ |
| Spiko USD | https://app.spiko.io/ |

Cross-reference: https://app.rwa.xyz/treasuries

## Why tokenized MMFs live in the Cash card, not the Stablecoin card

In a treasurer's mental model, a tokenized money market fund is a **cash
equivalent**, not a yield product. It's a regulated fund share backed
by short-term Treasuries, with same-day or next-day redemption to fiat
or USDC. Operationally, it belongs alongside bank balances, not
alongside DeFi positions or stablecoin holdings.

The holdings categorization function at
`src/lib/treasury/holdings-category.ts` enforces this deterministically:
any `yield_position` whose venue has `category === 'tokenized_mmf'`
routes to the **Cash & Cash Equivalents** card, regardless of the
venue's `status` field. This means a demo holding seeded against a
`coming_soon` MMF venue still displays in Cash — demo/visual content
is independent of live integration status.

## What's NOT in this PR

- **Live data fetching for tokenized MMFs.** The yield rate cache and
  per-minute cron pipeline are not extended to MMFs. Reference yields
  are static values from the registry, refreshed manually.
- **Real mint/redeem integrations.** All six MMF venues ship as
  `coming_soon`. The deposit flows in `/api/yield/deposit` still gate
  them out, and the UI shows the shared "Coming Soon" button treatment.
- **Per-customer eligibility gating.** `eligibility` tier is displayed
  on the card as a trust signal but doesn't gate visibility or deposits.
