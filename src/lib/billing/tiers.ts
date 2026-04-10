export type TierSlug = 'lite' | 'starter' | 'growth' | 'scale' | 'enterprise';

export interface TierDefinition {
  slug: TierSlug;
  name: string;
  price: number | null;         // monthly price in cents, null = custom (enterprise)
  displayPrice: string;         // for UI display
  liveMode: boolean;
  assetCapUsd: number | null;   // null = unlimited
  includedErps: number;         // live mode ERPs included
  kycRequired: boolean;
  kybRequired: boolean;
  creditCardRequired: boolean;
}

export const TIERS: Record<TierSlug, TierDefinition> = {
  lite: {
    slug: 'lite',
    name: 'Lite',
    price: 0,
    displayPrice: 'Free',
    liveMode: false,
    assetCapUsd: null,
    includedErps: 0,
    kycRequired: false,
    kybRequired: false,
    creditCardRequired: false,
  },
  starter: {
    slug: 'starter',
    name: 'Starter',
    price: 0,                   // Free
    displayPrice: 'Free',
    liveMode: true,
    assetCapUsd: 10_000_000,
    includedErps: 1,
    kycRequired: true,
    kybRequired: true,
    creditCardRequired: false,
  },
  growth: {
    slug: 'growth',
    name: 'Growth',
    price: 150000,              // $1,500.00
    displayPrice: '$1,500/mo',
    liveMode: true,
    assetCapUsd: 30_000_000,
    includedErps: 1,
    kycRequired: true,
    kybRequired: true,
    creditCardRequired: true,
  },
  scale: {
    slug: 'scale',
    name: 'Scale',
    price: 350000,              // $3,500.00
    displayPrice: '$3,500/mo',
    liveMode: true,
    assetCapUsd: 70_000_000,
    includedErps: 1,
    kycRequired: true,
    kybRequired: true,
    creditCardRequired: true,
  },
  enterprise: {
    slug: 'enterprise',
    name: 'Enterprise',
    price: null,
    displayPrice: 'Contact Us',
    liveMode: true,
    assetCapUsd: null,
    includedErps: 1,
    kycRequired: true,
    kybRequired: true,
    creditCardRequired: true,
  },
};

export const TIER_ORDER: TierSlug[] = ['lite', 'starter', 'growth', 'scale', 'enterprise'];

export const ERP_ADDON_PRICE_CENTS = 150000; // $1,500.00/mo

export const VANTOR_FEE_RATE = 0.0025; // 25 BPS (0.25%)

/** Returns true if `to` is a higher tier than `from` */
export function isUpgrade(from: TierSlug, to: TierSlug): boolean {
  return TIER_ORDER.indexOf(to) > TIER_ORDER.indexOf(from);
}

/** Returns true if `to` is a lower tier than `from` */
export function isDowngrade(from: TierSlug, to: TierSlug): boolean {
  return TIER_ORDER.indexOf(to) < TIER_ORDER.indexOf(from);
}

/** Returns true if the tier is a paid tier */
export function isPaidTier(tier: TierSlug): boolean {
  return tier !== 'lite';
}
