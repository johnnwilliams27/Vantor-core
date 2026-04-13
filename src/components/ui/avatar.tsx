import * as React from 'react';
import { cn } from '@/lib/utils';
import { StatusDot, type StatusDotVariant } from './status-dot';

/**
 * User avatar with initials on a hash-derived background color.
 * See style guide Section 09.
 *
 * Sizes: xs 24 · sm 32 (default) · md 40 · lg 48.
 * Shape is always rounded-full (circular — shape-mandated).
 * Background color is deterministic — hashing the name means "John"
 * always gets the same color across sessions and surfaces.
 * Pass presence for a bottom-right StatusDot indicator.
 */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

interface AvatarProps {
  /** User's full name — used for initials + bg color hash. */
  name: string;
  size?: AvatarSize;
  /** Optional presence indicator rendered at bottom-right. */
  presence?: StatusDotVariant;
  /** Optional explicit image URL (overrides initials). */
  src?: string;
  className?: string;
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-10 h-10 text-[13px]',
  lg: 'w-12 h-12 text-base',
};

const PRESENCE_OFFSET: Record<AvatarSize, string> = {
  xs: 'bottom-[-1px] right-[-1px]',
  sm: 'bottom-[-1px] right-[-1px]',
  md: 'bottom-[-2px] right-[-2px]',
  lg: 'bottom-[-2px] right-[-2px]',
};

/**
 * Deterministic bg color from the 8-color semantic palette.
 * Hashes name → one of 8 Tailwind color classes.
 */
const PALETTE = [
  'bg-teal-500',
  'bg-amber-500',
  'bg-red-500',
  'bg-blue-500',
  'bg-purple-500',
  'bg-gray-500',
  'bg-rose-500',
  'bg-green-600',
] as const;

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function colorForName(name: string): string {
  return PALETTE[hashName(name) % PALETTE.length];
}

function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, size = 'sm', presence, src, className }: AvatarProps) {
  const color = src ? '' : colorForName(name);
  const initials = initialsForName(name);

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className={cn('rounded-full object-cover', SIZE_CLASSES[size])}
        />
      ) : (
        <span
          role="img"
          aria-label={`${name} avatar`}
          className={cn(
            'inline-flex items-center justify-center rounded-full text-white font-semibold',
            SIZE_CLASSES[size],
            color,
          )}
        >
          {initials}
        </span>
      )}
      {presence && (
        <span
          className={cn(
            'absolute ring-2 ring-[var(--bg-void,#060d1f)]',
            PRESENCE_OFFSET[size],
          )}
        >
          <StatusDot variant={presence} size="sm" />
        </span>
      )}
    </span>
  );
}
