'use client';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { HoverTooltip } from '@/components/ui/hover-tooltip';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  /** The text to copy to clipboard. */
  value: string;
  /** What to call it in the success toast. Default "Copied to clipboard". */
  label?: string;
  /** Optional wrapper className. */
  className?: string;
  /** Optional custom children — renders the trigger. If omitted, renders a small icon button. */
  children?: React.ReactNode;
  /** Tooltip label. Default "Copy". */
  tooltip?: string;
}

export function CopyButton({ value, label = 'Copied to clipboard', className, children, tooltip = 'Copy' }: CopyButtonProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: label, variant: 'success' });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Copy failed', description: 'Clipboard access was blocked.', variant: 'destructive' });
    }
  };

  return (
    <HoverTooltip label={copied ? 'Copied' : tooltip}>
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          'inline-flex items-center gap-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
          className,
        )}
        aria-label={tooltip}
      >
        {children ?? (copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />)}
      </button>
    </HoverTooltip>
  );
}
