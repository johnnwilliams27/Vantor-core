'use client';

import { useEffect, useState, useRef } from 'react';

const INSIGHTS = [
  '$2.3M idle USDC → Spiko USD · +4.9% APY',
  '€1.8M payroll due → convert USD to EUR',
  '$500K vendor payment → withdraw Circle USYC',
  '$4.5M outbound wire → manager approval required',
  '$1.2M Spiko USD · 4.9% → Circle USYC · +5.1% APY',
];

const ROTATION_MS = 5000;

export function InsightFeed() {
  const [head, setHead] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const id = window.setInterval(() => {
      setHead((h) => (h + 1) % INSIGHTS.length);
    }, ROTATION_MS);
    return () => window.clearInterval(id);
  }, [paused, reducedMotion]);

  // Show 3 cards starting at `head`, wrapping around
  const visible = [0, 1, 2].map((i) => INSIGHTS[(head + i) % INSIGHTS.length]);

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-live="polite"
      aria-atomic="true"
      className="w-full max-w-3xl mx-auto"
    >
      <div className="space-y-3">
        {visible.map((text, i) => {
          const opacity = i === 0 ? 1 : i === 1 ? 0.85 : 0.6;
          const visibilityClass =
            i === 0 ? '' : i === 1 ? 'hidden sm:flex' : 'hidden lg:flex';
          return (
            <div
              key={`${head}-${i}`}
              style={{ opacity }}
              className={`${visibilityClass} items-center justify-between gap-4 px-5 py-4 rounded-xl border border-white/[0.08] bg-white/[0.025] transition-opacity duration-500 ${i === 0 ? 'flex' : ''}`}
            >
              <span className="text-sm sm:text-base text-[var(--text-100)] flex-1 min-w-0">
                {text}
              </span>
              <button
                type="button"
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border border-[var(--teal-400)]/40 text-[var(--teal-400)] hover:bg-[var(--teal-400)]/10 transition-colors min-h-[32px]"
              >
                Approve?
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
