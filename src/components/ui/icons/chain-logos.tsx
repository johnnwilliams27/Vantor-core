import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ChainLogoProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
}

/** Ethereum diamond mark (Foundation brand). */
export function EthereumLogo({ size = 24, ...rest }: ChainLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 417"
      aria-hidden="true"
      {...rest}
    >
      <path fill="#343434" d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" />
      <path fill="#8C8C8C" d="M127.962 0L0 212.32l127.962 75.639V154.158z" />
      <path fill="#3C3C3B" d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587z" />
      <path fill="#8C8C8C" d="M127.962 416.905v-104.72L0 236.585z" />
      <path fill="#141414" d="M127.961 287.958l127.961-75.637-127.961-58.162z" />
      <path fill="#393939" d="M0 212.32l127.96 75.638v-133.8z" />
    </svg>
  );
}

/** Solana three-bar gradient mark. */
export function SolanaLogo({ size = 24, ...rest }: ChainLogoProps) {
  const gradId = React.useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 397.7 311.7"
      aria-hidden="true"
      {...rest}
    >
      <defs>
        <linearGradient id={`sol-a-${gradId}`} x1="360.879" x2="141.213" y1="351.455" y2="-69.294" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient id={`sol-b-${gradId}`} x1="264.829" x2="45.163" y1="401.601" y2="-19.148" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient id={`sol-c-${gradId}`} x1="312.548" x2="92.882" y1="376.688" y2="-44.061" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <path fill={`url(#sol-a-${gradId})`} d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 237.9z" />
      <path fill={`url(#sol-b-${gradId})`} d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
      <path fill={`url(#sol-c-${gradId})`} d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.6z" />
    </svg>
  );
}

/**
 * Shared chain badge — icon + label + chain-specific tint. Centralizes the
 * "what chain is this row on?" visual treatment across wallets, transfer
 * tables, balance cards, etc. so the user learns one shape.
 */
interface ChainBadgeProps {
  chain: string | null | undefined;
  /** Short ("ETH") vs full ("Ethereum") label. Default full. */
  short?: boolean;
  className?: string;
}

export function ChainBadge({ chain, short = false, className }: ChainBadgeProps) {
  const isEthereum = chain === 'ethereum';
  const isSolana = chain === 'solana';

  if (!isEthereum && !isSolana) {
    return (
      <Badge variant="secondary" className={cn(className)}>
        {chain ?? '—'}
      </Badge>
    );
  }

  const label = isEthereum ? (short ? 'ETH' : 'Ethereum') : short ? 'SOL' : 'Solana';

  return (
    <Badge variant={isEthereum ? 'ethereum' : 'solana'} className={cn('gap-1', className)}>
      {isEthereum ? (
        <EthereumLogo size={10} className="shrink-0" />
      ) : (
        <SolanaLogo size={10} className="shrink-0" />
      )}
      {label}
    </Badge>
  );
}
