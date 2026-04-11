/**
 * Canonical venue metadata registry.
 *
 * This is the single source of truth for every yield venue Vantor knows
 * about — DeFi vaults, DeFi lending markets, and tokenized money market
 * funds. Static TypeScript, not database-backed: venues change on the
 * order of once a month, the set is small and hand-curated, and type
 * safety via the discriminated union in `categories.ts` is more valuable
 * than row-level mutability.
 *
 * **Provenance of MMF seed numbers (as of 2026-04-11):**
 *   Fund size and yield for all six tokenized MMFs below are taken from
 *   rwa.xyz's Treasury Dashboard. The yields are 7-day annualized, not
 *   net-of-fees. Refresh quarterly against each issuer's dashboard:
 *     - BlackRock BUIDL → https://securitize.io/primary-market/buidl
 *     - Ondo OUSG      → https://ondo.finance/
 *     - Superstate USTB → https://superstate.com/
 *     - Franklin BENJI → https://www.franklintempleton.com/
 *     - Circle USYC    → https://www.circle.com/
 *     - Spiko USD      → https://app.spiko.io/
 *   Cross-reference: https://app.rwa.xyz/treasuries
 */

import type { VenueMetadata } from './categories';
import type { YieldProtocolId } from '@/lib/yield/interface';

/** ISO date the tokenized MMF reference yields were captured. */
export const MMF_YIELDS_AS_OF = '2026-04-11';

export const VENUES: Record<YieldProtocolId, VenueMetadata> = {
  // ─── DeFi Lending Markets ─────────────────────────────────────────

  aave_v3: {
    id: 'aave_v3',
    category: 'defi_lending_market',
    displayName: 'Aave V3',
    description: 'Leading decentralized lending protocol. Supply stablecoins to earn yield from borrowers.',
    chain: 'ethereum',
    supportedTokens: ['USDC', 'USDT'],
    status: 'live',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 2 },
    kycRequired: false,
    underlyingProtocol: 'Aave',
    marketAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    monthsLive: 36,
  },

  compound_v3: {
    id: 'compound_v3',
    category: 'defi_lending_market',
    displayName: 'Compound V3',
    description: 'Battle-tested lending protocol. Supply stablecoins to the Comet market and earn yield from borrowers.',
    chain: 'ethereum',
    supportedTokens: ['USDC', 'USDT'],
    status: 'live',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 2 },
    kycRequired: false,
    underlyingProtocol: 'Compound V3',
    marketAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
    monthsLive: 28,
  },

  kamino: {
    id: 'kamino',
    category: 'defi_lending_market',
    displayName: 'Kamino Lend',
    description: 'Largest Solana lending protocol. Supply stablecoins to earn yield from Solana borrowers.',
    chain: 'solana',
    supportedTokens: ['USDC', 'USDT'],
    status: 'live',
    riskLevel: 'medium',
    riskFactors: { smartContract: 2, counterparty: 1, liquidity: 2, regulatory: 3 },
    kycRequired: false,
    underlyingProtocol: 'Kamino',
    marketAddress: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
    monthsLive: 18,
  },

  // ─── DeFi Vaults ──────────────────────────────────────────────────

  morpho_steakhouse: {
    id: 'morpho_steakhouse',
    category: 'defi_vault',
    displayName: 'Morpho Steakhouse USDC',
    description: 'Steakhouse-curated Morpho vault. Concentrated exposure to high-yield markets with active risk management.',
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    status: 'live',
    riskLevel: 'high',
    riskFactors: { smartContract: 2, counterparty: 2, liquidity: 3, regulatory: 2 },
    kycRequired: false,
    curator: 'Steakhouse Financial',
    underlyingProtocol: 'Morpho Blue',
    vaultAddress: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    monthsLive: 12,
    lastIncidentDate: null,
  },

  morpho_reservoir: {
    id: 'morpho_reservoir',
    category: 'defi_vault',
    displayName: 'Morpho Reservoir USDC',
    description: 'Reservoir-curated Morpho vault for high-yield USDC supply across optimized markets.',
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    status: 'live',
    riskLevel: 'medium',
    riskFactors: { smartContract: 2, counterparty: 2, liquidity: 2, regulatory: 2 },
    kycRequired: false,
    curator: 'Reservoir',
    underlyingProtocol: 'Morpho Blue',
    vaultAddress: '0xbeEF346d7099865208Ff331e4f648f4154DDAa05',
    monthsLive: 8,
    lastIncidentDate: null,
  },

  kamino_multiply: {
    id: 'kamino_multiply',
    category: 'defi_vault',
    displayName: 'Kamino Multiply',
    description: 'Leveraged yield strategy on Solana. Automated looping for amplified stablecoin returns with liquidation risk.',
    chain: 'solana',
    supportedTokens: ['USDC'],
    status: 'live',
    riskLevel: 'high',
    riskFactors: { smartContract: 2, counterparty: 2, liquidity: 3, regulatory: 3 },
    kycRequired: false,
    curator: 'Kamino',
    underlyingProtocol: 'Kamino',
    vaultAddress: null,
    monthsLive: 14,
    lastIncidentDate: null,
  },

  // ─── Ondo USDY (kept as defi_vault — it's a yield-bearing token,
  //     not a QP-gated MMF like OUSG) ───────────────────────────────

  ondo_usdy: {
    id: 'ondo_usdy',
    category: 'defi_vault',
    displayName: 'Ondo USDY',
    description: 'Tokenized US Treasury yield. Mint USDY backed by short-term T-bills. KYC required.',
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    status: 'coming_soon',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 2, liquidity: 2, regulatory: 1 },
    kycRequired: true,
    curator: 'Ondo Finance',
    underlyingProtocol: 'Ondo',
    vaultAddress: null,
    monthsLive: 27,
    lastIncidentDate: null,
  },

  // ─── Other non-MMF venues (coming_soon, not yet wired) ───────────

  sky: {
    id: 'sky',
    category: 'defi_vault',
    displayName: 'Sky sUSDS',
    description: 'Savings rate from Sky (formerly MakerDAO). Deposit stablecoins to earn the Sky Savings Rate backed by RWA revenue.',
    chain: 'ethereum',
    supportedTokens: ['USDC', 'USDT'],
    status: 'coming_soon',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 2 },
    kycRequired: false,
    curator: 'Sky Protocol',
    underlyingProtocol: 'Sky',
    vaultAddress: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
    monthsLive: 10,
    lastIncidentDate: null,
  },

  ethena: {
    id: 'ethena',
    category: 'defi_vault',
    displayName: 'Ethena sUSDe',
    description: 'Synthetic dollar protocol. Stake USDe for yield derived from delta-neutral ETH positions and funding rate arbitrage.',
    chain: 'ethereum',
    supportedTokens: ['USDC', 'USDT'],
    status: 'coming_soon',
    riskLevel: 'high',
    riskFactors: { smartContract: 2, counterparty: 3, liquidity: 2, regulatory: 3 },
    kycRequired: false,
    curator: 'Ethena Labs',
    underlyingProtocol: 'Ethena',
    vaultAddress: null,
    monthsLive: 22,
    lastIncidentDate: null,
  },

  // ─── Tokenized Money Market Funds (all coming_soon) ──────────────
  // Numbers from rwa.xyz as of MMF_YIELDS_AS_OF. Refresh quarterly.

  buidl: {
    id: 'buidl',
    category: 'tokenized_mmf',
    displayName: 'BlackRock BUIDL',
    description: "BlackRock's flagship tokenized money market fund. The largest and most institutionally credible tokenized Treasury product.",
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    status: 'coming_soon',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 1 },
    kycRequired: true,
    issuer: 'BlackRock',
    fundManager: 'BlackRock Financial Management',
    fundSizeUsd: 2_370_000_000,  // $2.37B
    underlyingComposition: 'Short-term US Treasuries, repo, cash',
    regulatoryWrapper: 'Reg D 506(c) · Cayman feeder',
    eligibility: 'qualified_purchaser',
    referenceYield: 0.0347, // 3.47% 7-day APY
    yieldAsOf: MMF_YIELDS_AS_OF,
    currency: 'USD',
    supportedChains: ['Ethereum', 'Aptos', 'Arbitrum', 'Avalanche', 'Optimism', 'Polygon'],
    redemptionMechanics: 't_plus_0',
    timeToCash: 'T+0 same-day',
    reportingCadence: 'Daily NAV',
    onboardingPartner: 'Securitize',
    notes: "BlackRock's flagship tokenized money market fund. The largest and most institutionally credible tokenized Treasury product.",
  },

  ousg: {
    id: 'ousg',
    category: 'tokenized_mmf',
    displayName: 'Ondo OUSG',
    description: "Ondo's qualified purchaser tier. Holds BUIDL as the primary underlying with 24/7 mint/redeem via stablecoin.",
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    status: 'coming_soon',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 1 },
    kycRequired: true,
    issuer: 'Ondo Finance',
    fundManager: 'Ondo / BlackRock (BUIDL underlying)',
    fundSizeUsd: 684_400_000,  // $684.4M
    underlyingComposition: 'Primarily BlackRock BUIDL',
    regulatoryWrapper: 'Reg D 506(c)',
    eligibility: 'qualified_purchaser',
    referenceYield: 0.0337, // 3.37% 7-day APY
    yieldAsOf: MMF_YIELDS_AS_OF,
    currency: 'USD',
    supportedChains: ['Ethereum', 'Solana', 'Polygon', 'Sui'],
    redemptionMechanics: 'instant_24_7',
    timeToCash: '24/7 instant',
    reportingCadence: 'Daily NAV',
    onboardingPartner: 'Ondo / Securitize',
    notes: "Ondo's qualified purchaser tier. Holds BUIDL as the primary underlying with 24/7 mint/redeem via stablecoin.",
  },

  ustb: {
    id: 'ustb',
    category: 'tokenized_mmf',
    displayName: 'Superstate USTB',
    description: 'ETF-veteran management transitioning to Invesco. SEC-registered structure with KYC\'d allowlist.',
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    status: 'coming_soon',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 2, regulatory: 1 },
    kycRequired: true,
    issuer: 'Superstate',
    fundManager: 'Invesco Advisers (transitioning Q2 2026 from Superstate)',
    fundSizeUsd: 646_000_000,  // $646M
    underlyingComposition: 'Short-duration US government securities',
    regulatoryWrapper: 'SEC-registered',
    eligibility: 'qualified_purchaser',
    referenceYield: 0.0348, // 3.48% 7-day APY
    yieldAsOf: MMF_YIELDS_AS_OF,
    currency: 'USD',
    supportedChains: ['Ethereum'],
    redemptionMechanics: 't_plus_1_daily_nav',
    timeToCash: 'T+1 daily NAV',
    reportingCadence: 'Daily NAV',
    onboardingPartner: 'Superstate allowlist',
    notes: 'ETF-veteran management transitioning to Invesco. SEC-registered structure with KYC\'d allowlist.',
  },

  benji: {
    id: 'benji',
    category: 'tokenized_mmf',
    displayName: 'Franklin Templeton BENJI',
    description: 'One of the earliest traditional asset managers in tokenized money markets. SEC-registered 1940 Act structure with traditional fund credibility.',
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    status: 'coming_soon',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 2, regulatory: 1 },
    kycRequired: true,
    issuer: 'Franklin Templeton',
    fundManager: 'Franklin Templeton',
    fundSizeUsd: 1_020_000_000,  // $1.02B
    underlyingComposition: 'US government securities, repo',
    regulatoryWrapper: 'SEC-registered (1940 Act)',
    eligibility: 'none',
    referenceYield: 0.0353, // 3.53% 7-day APY
    yieldAsOf: MMF_YIELDS_AS_OF,
    currency: 'USD',
    supportedChains: ['Stellar', 'Polygon', 'Ethereum', 'Arbitrum', 'Base', 'Avalanche'],
    redemptionMechanics: 't_plus_1_daily_nav',
    timeToCash: 'T+1 daily NAV',
    reportingCadence: 'Daily NAV',
    onboardingPartner: 'Franklin Templeton institutional',
    notes: 'One of the earliest traditional asset managers in tokenized money markets. SEC-registered 1940 Act structure with traditional fund credibility.',
  },

  usyc: {
    id: 'usyc',
    category: 'tokenized_mmf',
    displayName: 'Circle USYC',
    description: "Circle's tokenized Treasury offering, natural pairing for USDC-native customers.",
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    status: 'coming_soon',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 1 },
    kycRequired: true,
    issuer: 'Circle (via Hashnote acquisition)',
    fundManager: 'Circle International Bermuda',
    fundSizeUsd: 2_670_000_000,  // $2.67B
    underlyingComposition: 'Short-term US Treasuries',
    regulatoryWrapper: 'Cayman',
    eligibility: 'qualified_purchaser',
    referenceYield: 0.0318, // 3.18% 7-day APY
    yieldAsOf: MMF_YIELDS_AS_OF,
    currency: 'USD',
    supportedChains: ['Ethereum'],
    redemptionMechanics: 't_plus_0',
    timeToCash: 'T+0 same-day',
    reportingCadence: 'Daily NAV',
    onboardingPartner: 'Circle',
    notes: "Circle's tokenized Treasury offering, natural pairing for USDC-native customers.",
  },

  spiko_usd: {
    id: 'spiko_usd',
    category: 'tokenized_mmf',
    displayName: 'Spiko USD',
    description: 'EU-regulated MMF with daily NAV. Lower onboarding friction than QP-gated products.',
    chain: 'ethereum',
    supportedTokens: ['USDC'],
    status: 'coming_soon',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 1 },
    kycRequired: true,
    issuer: 'Spiko',
    fundManager: 'Spiko SICAV (regulated by AMF)',
    fundSizeUsd: 155_800_000,  // $155.8M (USTBL fund)
    underlyingComposition: 'Short-term US Treasuries',
    regulatoryWrapper: 'EU-regulated MMF (UCITS)',
    eligibility: 'none',
    referenceYield: 0.0405, // 4.05% 7-day APY
    yieldAsOf: MMF_YIELDS_AS_OF,
    currency: 'USD',
    supportedChains: ['Ethereum', 'Polygon'],
    redemptionMechanics: 't_plus_1_daily_nav',
    timeToCash: 'T+1 daily NAV',
    reportingCadence: 'Daily NAV',
    onboardingPartner: 'Spiko allowlist',
    notes: 'EU-regulated MMF with daily NAV. Lower onboarding friction than QP-gated products.',
  },
};

/** All venue IDs — useful for iteration and API responses. */
export const ALL_VENUE_IDS = Object.keys(VENUES) as YieldProtocolId[];

/** Get a venue by ID, or null if unknown. Prefer this over raw VENUES access. */
export function getVenue(id: YieldProtocolId | string | null | undefined): VenueMetadata | null {
  if (!id) return null;
  return (VENUES as Record<string, VenueMetadata>)[id] ?? null;
}
