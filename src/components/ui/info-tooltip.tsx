'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InfoTooltipProps {
  content: string;
  className?: string;
}

export function InfoTooltip({ content, className }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, arrowLeft: 128 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const TOOLTIP_WIDTH = 256;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const triggerCenterX = rect.left + rect.width / 2;

    let left = triggerCenterX - TOOLTIP_WIDTH / 2;
    let arrowLeft = TOOLTIP_WIDTH / 2;

    const minLeft = 8;
    const maxLeft = window.innerWidth - TOOLTIP_WIDTH - 8;

    if (left < minLeft) {
      arrowLeft = arrowLeft + (left - minLeft);
      left = minLeft;
    } else if (left > maxLeft) {
      arrowLeft = arrowLeft + (left - maxLeft);
      left = maxLeft;
    }

    arrowLeft = Math.max(12, Math.min(arrowLeft, TOOLTIP_WIDTH - 12));

    const tooltipHeight = tooltip?.offsetHeight ?? 40;
    const top = rect.top - tooltipHeight - 8;

    setPos({ top, left, arrowLeft });
    setPositioned(true);
  }, []);

  useEffect(() => {
    if (open) {
      setPositioned(false);
      requestAnimationFrame(() => requestAnimationFrame(updatePosition));
    } else {
      setPositioned(false);
    }
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        tooltipRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open, updatePosition]);

  // Only show in browser
  const visible = open && positioned;

  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-muted-foreground hover:text-foreground transition-colors"
        aria-label="More info"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {typeof window !== 'undefined' && createPortal(
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: TOOLTIP_WIDTH,
            zIndex: 9999,
            visibility: open ? 'visible' : 'hidden',
          }}
          className={cn(
            'rounded-lg border bg-popover text-popover-foreground shadow-lg px-3 py-2.5 text-xs leading-relaxed whitespace-pre-line transition-opacity duration-150',
            visible
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none',
          )}
        >
          {content}
          <div
            className="absolute top-full -mt-px"
            style={{ left: pos.arrowLeft }}
          >
            <div className="w-2.5 h-2.5 -translate-x-1/2 rotate-45 bg-popover border-b border-r border-border" />
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
