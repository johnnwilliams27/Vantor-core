'use client';
import { useRef, useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface Tab<T extends string> {
  value: T;
  label: string;
}

interface TabNavProps<T extends string> {
  tabs: Tab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function TabNav<T extends string>({ tabs, value, onChange, className }: TabNavProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    const el = tabRefs.current.get(value);
    const container = containerRef.current;
    if (!el || !container) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    setIndicator({
      left: elRect.left - containerRect.left,
      width: elRect.width,
    });
  }, [value]);

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  // Recalculate on resize
  useEffect(() => {
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  return (
    <div
      ref={containerRef}
      className={cn('relative inline-flex items-center gap-1 rounded-lg bg-muted/60 p-1', className)}
    >
      {/* Sliding indicator */}
      <div
        className="absolute top-1 bottom-1 rounded-md bg-background shadow-sm ring-1 ring-border/50 transition-[left,width] duration-200 ease-out"
        style={{ left: indicator.left, width: indicator.width }}
      />

      {tabs.map((tab) => (
        <button
          key={tab.value}
          ref={(el) => {
            if (el) tabRefs.current.set(tab.value, el);
          }}
          onClick={() => onChange(tab.value)}
          className={cn(
            'relative z-10 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50',
            value === tab.value
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground/80'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
