/**
 * Published Bridge banking rail fees.
 *
 * Bridge does NOT expose a pre-quote API for fiat payments — the `/v0/transfers`
 * endpoint only returns fee info after actually creating a transfer. To give
 * users an accurate fee estimate before they submit, we maintain this static
 * lookup table of Bridge's published rates.
 *
 * Source of truth: Bridge's published fee schedule (verify with Bridge support
 * before raising in the UI; these values may drift over time). When updating
 * rates, bump `RAIL_FEES_UPDATED_AT` and leave a comment explaining why.
 *
 * Last verified: 2026-04-11 (approximate rates — confirm with Bridge before launch)
 */

export type PaymentRail =
  | 'ach_push'
  | 'ach_same_day'
  | 'wire'
  | 'swift'
  | 'sepa'
  | 'spei'
  | 'pix';

export interface RailFeeSchedule {
  /** Bridge rail identifier passed on /v0/transfers source.payment_rail */
  rail: PaymentRail;
  /** User-facing label for the dropdown */
  label: string;
  /** Short description of speed/coverage */
  description: string;
  /** Flat fee in the rail's settlement currency (null if percentage-only) */
  flatFee: number | null;
  /** Percentage fee as decimal (e.g. 0.001 = 0.1%). null if flat-only */
  percentFee: number | null;
  /** Settlement currency for the flat fee */
  currency: string;
  /** Approximate settlement time for UX copy */
  settlementTime: string;
  /** Currencies this rail supports */
  supportedCurrencies: string[];
}

export const RAIL_FEES_UPDATED_AT = '2026-04-11';

export const RAIL_FEES: Record<PaymentRail, RailFeeSchedule> = {
  ach_push: {
    rail: 'ach_push',
    label: 'ACH (Standard)',
    description: 'US domestic, 1–2 business days',
    flatFee: 0.5,
    percentFee: null,
    currency: 'USD',
    settlementTime: '1–2 business days',
    supportedCurrencies: ['USD'],
  },
  ach_same_day: {
    rail: 'ach_same_day',
    label: 'ACH (Same-day)',
    description: 'US domestic, same business day',
    flatFee: 2,
    percentFee: null,
    currency: 'USD',
    settlementTime: 'Same business day',
    supportedCurrencies: ['USD'],
  },
  wire: {
    rail: 'wire',
    label: 'Wire Transfer',
    description: 'US domestic, same day',
    flatFee: 20,
    percentFee: null,
    currency: 'USD',
    settlementTime: 'Same business day',
    supportedCurrencies: ['USD'],
  },
  swift: {
    rail: 'swift',
    label: 'SWIFT (International)',
    description: 'International wire, 1–3 business days',
    flatFee: 25,
    percentFee: 0.001, // 0.1%
    currency: 'USD',
    settlementTime: '1–3 business days',
    supportedCurrencies: ['USD', 'EUR', 'GBP'],
  },
  sepa: {
    rail: 'sepa',
    label: 'SEPA',
    description: 'EU payments area, 1–2 business days',
    flatFee: 0.5,
    percentFee: null,
    currency: 'EUR',
    settlementTime: '1–2 business days',
    supportedCurrencies: ['EUR'],
  },
  spei: {
    rail: 'spei',
    label: 'SPEI',
    description: 'Mexico domestic, same day',
    flatFee: 5,
    percentFee: null,
    currency: 'MXN',
    settlementTime: 'Same business day',
    supportedCurrencies: ['MXN'],
  },
  pix: {
    rail: 'pix',
    label: 'PIX',
    description: 'Brazil domestic, instant',
    flatFee: 0.5,
    percentFee: null,
    currency: 'BRL',
    settlementTime: 'Instant',
    supportedCurrencies: ['BRL'],
  },
};

export function calculateRailFee(
  rail: PaymentRail,
  amount: number,
): { flat: number; percent: number; total: number; currency: string } {
  const schedule = RAIL_FEES[rail];
  if (!schedule) {
    return { flat: 0, percent: 0, total: 0, currency: 'USD' };
  }
  const flat = schedule.flatFee ?? 0;
  const percent = schedule.percentFee ? amount * schedule.percentFee : 0;
  return {
    flat,
    percent,
    total: flat + percent,
    currency: schedule.currency,
  };
}

/** Returns the rails that support a given currency, in dropdown order. */
export function getAvailableRails(currency: string): RailFeeSchedule[] {
  const ccy = currency.toUpperCase();
  return Object.values(RAIL_FEES).filter((r) =>
    r.supportedCurrencies.includes(ccy),
  );
}
