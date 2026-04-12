'use client';

import { InfoTooltip } from '@/components/ui/info-tooltip';

/**
 * Centralized Vantor vocab so tooltips across the product stay aligned
 * with the house rules on stablecoin / fiat / rail terminology. When a
 * new term enters the UI, add it here instead of writing a one-off
 * tooltip string — that way the definition stays consistent no matter
 * which surface it appears on.
 */
export const VANTOR_GLOSSARY: Record<string, string> = {
  stablecoin:
    'Price-stable digital currency (USDC, USDT) pegged to a fiat unit. Vantor moves value as stablecoins on-chain, not volatile crypto.',
  USDC:
    'USD Coin — fully-reserved stablecoin issued by Circle, redeemable 1:1 for USD. Attestations monthly.',
  USDT:
    'Tether — USD-pegged stablecoin issued by Tether Ltd. Largest by supply. Reserve composition attested quarterly.',
  'on-ramp':
    'Move value from a bank account (fiat) into a stablecoin wallet. "Buy" USDC/USDT with USD, EUR, GBP, BRL, or MXN.',
  'off-ramp':
    'Move value from a stablecoin wallet into a bank account (fiat). Sell USDC/USDT back to USD, EUR, GBP, BRL, or MXN.',
  swap:
    'Exchange one stablecoin for another on the same chain (e.g. USDC ↔ USDT on Ethereum).',
  bridge:
    'Move the same stablecoin across different chains (e.g. USDC on Ethereum → USDC on Solana).',
  rail:
    'The underlying banking network that moves fiat between accounts — ACH, wire, SWIFT, SEPA, SPEI, PIX. Each has different speed, cost, and geography.',
  KYB:
    'Know Your Business — identity and ownership verification for your organization before Vantor can move real funds.',
  KYC:
    'Know Your Customer — identity verification for each team member with sign-off authority on money movement.',
  'treasury rule':
    'An automation you author that tells the Vantor agent how to react to treasury conditions — "if stablecoin balance > $500k, propose a Morpho deposit." Rules propose; humans approve.',
};

export type VantorTerm = keyof typeof VANTOR_GLOSSARY;

interface GlossaryTooltipProps {
  /**
   * The term to look up. Lookup is case-sensitive — use the exact key from
   * VANTOR_GLOSSARY. Unknown terms render children without a tooltip so
   * the surface never shows an empty tooltip trigger.
   */
  term: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Wrap any text/element with a Vantor-vocabulary tooltip. Silently falls
 * back to plain children when the term isn't in the glossary — avoids
 * empty tooltip triggers on typos.
 *
 * @example
 *   Deposit funds into a <GlossaryTooltip term="stablecoin">stablecoin</GlossaryTooltip> wallet.
 */
export function GlossaryTooltip({ term, children, className }: GlossaryTooltipProps) {
  const def = VANTOR_GLOSSARY[term];
  if (!def) return <>{children}</>;
  return (
    <InfoTooltip content={def} ariaLabel={`${term} — definition`} className={className}>
      {children ?? <span className="underline decoration-dotted underline-offset-2">{term}</span>}
    </InfoTooltip>
  );
}
