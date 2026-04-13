import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Rounded tile that holds an icon. See style guide Section 03.
 *
 * Replaces ~25 inline <div className="w-10 h-10 rounded-lg bg-*-500/10 flex items-center justify-center"> patterns.
 *
 * Size scale: xs 24 · sm 32 · md 40 · lg 48 · xl 56.
 * Semantic variants inherit the badge color palette.
 * Brand variants use solid brand colors for integrations and chains.
 * Shape is rounded-lg by default; set shape="circle" for ceremonial
 * uses (success check, error X, onboarding hero).
 */
export type IconTileVariant =
  // Semantic (inherit badge palette)
  | 'active'
  | 'pending'
  | 'failed'
  | 'info'
  | 'special'
  | 'inactive'
  | 'urgent'
  | 'live'
  // Brand — chains
  | 'brand-eth'
  | 'brand-sol'
  // Brand — integrations (solid brand color + white icon)
  | 'brand-slack'
  | 'brand-teams'
  | 'brand-email'
  | 'brand-zapier'
  | 'brand-pagerduty'
  | 'brand-webhook';

export type IconTileSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type IconTileShape = 'rounded' | 'circle';

interface IconTileProps {
  variant: IconTileVariant;
  size?: IconTileSize;
  shape?: IconTileShape;
  /** Adds a border at the variant's tint for emphasized surfaces. */
  emphasized?: boolean;
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}

const SIZE_CLASSES: Record<IconTileSize, string> = {
  xs: 'w-6 h-6 [&>svg]:w-3.5 [&>svg]:h-3.5',
  sm: 'w-8 h-8 [&>svg]:w-4 [&>svg]:h-4',
  md: 'w-10 h-10 [&>svg]:w-5 [&>svg]:h-5',
  lg: 'w-12 h-12 [&>svg]:w-6 [&>svg]:h-6',
  xl: 'w-14 h-14 [&>svg]:w-7 [&>svg]:h-7',
};

const VARIANT_CLASSES: Record<IconTileVariant, string> = {
  // Semantic — tinted bg + colored icon via inherited text color
  active: 'bg-teal-500/10 text-teal-400',
  pending: 'bg-amber-500/10 text-amber-400',
  failed: 'bg-red-500/10 text-red-400',
  info: 'bg-blue-500/10 text-blue-400',
  special: 'bg-purple-500/10 text-purple-400',
  inactive: 'bg-gray-500/10 text-gray-400',
  urgent: 'bg-rose-500/10 text-rose-400',
  live: 'bg-green-500/10 text-green-400',
  // Brand chains — tinted with chain color
  'brand-eth': 'bg-blue-500/10 text-blue-400',
  'brand-sol': 'bg-purple-500/10 text-purple-400',
  // Brand integrations — solid brand bg with white icon
  'brand-slack': 'bg-[#4A154B] text-white',
  'brand-teams': 'bg-[#4B53BC] text-white',
  'brand-email': 'bg-blue-500/10 text-blue-400',
  'brand-zapier': 'bg-[#FF4F00] text-white',
  'brand-pagerduty': 'bg-[#06AC38] text-white',
  'brand-webhook': 'bg-gray-500/10 text-gray-300',
};

const BORDER_CLASSES: Record<IconTileVariant, string> = {
  active: 'border-teal-500/20',
  pending: 'border-amber-500/20',
  failed: 'border-red-500/20',
  info: 'border-blue-500/20',
  special: 'border-purple-500/20',
  inactive: 'border-gray-500/20',
  urgent: 'border-rose-500/20',
  live: 'border-green-500/20',
  'brand-eth': 'border-blue-500/20',
  'brand-sol': 'border-purple-500/20',
  'brand-slack': 'border-white/10',
  'brand-teams': 'border-white/10',
  'brand-email': 'border-blue-500/20',
  'brand-zapier': 'border-white/10',
  'brand-pagerduty': 'border-white/10',
  'brand-webhook': 'border-gray-500/20',
};

export function IconTile({
  variant,
  size = 'md',
  shape = 'rounded',
  emphasized,
  children,
  className,
  'aria-label': ariaLabel,
}: IconTileProps) {
  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center justify-center shrink-0',
        shape === 'rounded' ? 'rounded-lg' : 'rounded-full',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        emphasized && `border ${BORDER_CLASSES[variant]}`,
        className,
      )}
    >
      {children}
    </span>
  );
}
