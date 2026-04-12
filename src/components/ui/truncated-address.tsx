'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { truncateAddress } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface TruncatedAddressProps {
  /** The full address (0x… or base58) to display. */
  address: string;
  /** Number of chars to show on each side of the ellipsis. Default 6. */
  chars?: number;
  /** Show the copy button. Default true. */
  showCopy?: boolean;
  /** Allow click-to-expand. Default true. */
  expandable?: boolean;
  /** Extra classes on the wrapper. */
  className?: string;
  /** Extra classes on the address button. */
  addressClassName?: string;
}

/**
 * Display a blockchain address in truncated form with optional click-to-expand
 * and inline copy-to-clipboard. Source of truth for the copy+expand pattern
 * across every table, list, or modal where an address appears.
 *
 * Not suitable inside a native <option> — use `truncateAddress()` directly
 * for option labels, since options can only contain text.
 */
export function TruncatedAddress({
  address,
  chars = 6,
  showCopy = true,
  expandable = true,
  className,
  addressClassName,
}: TruncatedAddressProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast({ title: 'Address copied', variant: 'success' });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Clipboard access was blocked by the browser.',
        variant: 'destructive',
      });
    }
  };

  const displayed = expanded ? address : truncateAddress(address, chars);

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 font-mono text-sm', className)}
    >
      {expandable ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => {
            // Keyboard shortcut: focus + press "c" to copy without having
            // to tab to the copy button. aria-keyshortcuts surfaces this
            // to assistive tech.
            if (
              showCopy &&
              (e.key === 'c' || e.key === 'C') &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.altKey
            ) {
              e.preventDefault();
              handleCopy();
            }
          }}
          aria-keyshortcuts={showCopy ? 'C' : undefined}
          className={cn(
            'text-left break-all transition-colors cursor-pointer',
            'hover:text-[#19595b] dark:hover:text-teal-400',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 rounded',
            addressClassName,
          )}
          title={
            expanded
              ? 'Click to collapse · press C to copy'
              : 'Click to expand · press C to copy'
          }
          aria-label={expanded ? 'Collapse address' : 'Expand address'}
          aria-expanded={expanded}
        >
          {displayed}
        </button>
      ) : (
        <span className={cn('break-all', addressClassName)}>{displayed}</span>
      )}

      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'shrink-0 p-1 rounded-md transition-colors',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
          )}
          title="Copy address"
          aria-label="Copy address to clipboard"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </span>
  );
}
