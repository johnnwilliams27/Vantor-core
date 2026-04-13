import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Note panel — purple-tinted editorial prose surface for Channel 2
 * advisory notes. Children-based; use for narrative Agent-authored
 * observations. For structured financial quotes see `QuotePanel`.
 *
 * Part of the Agent Surfaces system (see
 * docs/superpowers/specs/2026-04-13-agent-surfaces-design.md §8).
 */
interface NotePanelProps {
  /** Small uppercase label above the heading (e.g. "Note"). */
  eyebrow: React.ReactNode;
  /** Primary title of the note. */
  heading: React.ReactNode;
  /** Prose content. Caller controls paragraph structure. */
  children: React.ReactNode;
  /** Optional filing signature line (e.g. "Filed 04:12"). */
  signature?: React.ReactNode;
  className?: string;
}

export function NotePanel({
  eyebrow,
  heading,
  children,
  signature,
  className,
}: NotePanelProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-purple-500/20 bg-purple-500/5 p-5',
        className,
      )}
    >
      <div className="text-xs uppercase tracking-wide text-purple-400 font-medium">
        {eyebrow}
      </div>
      <h3 className="mt-1 text-lg font-bold text-foreground">{heading}</h3>
      <div className="mt-3 max-w-[65ch] text-sm leading-relaxed text-foreground/90 space-y-3">
        {children}
      </div>
      {signature !== undefined && (
        <div
          data-testid="note-panel-signature"
          className="mt-4 text-xs text-muted-foreground"
        >
          {signature}
        </div>
      )}
    </div>
  );
}
