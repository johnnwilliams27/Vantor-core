'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

const INSIGHTS = [
  { text: '$2.3M idle USDC → ', cyan: 'Spiko USD', mid: ' · ', teal: '+4.9% APY' },
  { text: '€1.8M payroll due → ', cyan: 'Convert USD to EUR', mid: '', teal: '' },
  { text: '$500K vendor payment → ', cyan: 'Withdrawal Circle USYC', mid: '', teal: '' },
  { text: '£750K receivable due Friday → ', cyan: 'Pre-fund GBP account', mid: '', teal: '' },
  { text: '$4.5M outbound wire → ', cyan: 'Manager approval required', mid: '', teal: '' },
  { text: '$1.2M Spiko USD · 4.9% → ', cyan: 'Circle USYC', mid: ' · ', teal: '+5.1% APY' },
  { text: '$2.8M quarterly tax → ', cyan: 'Schedule USD payment', mid: '', teal: '' },
];

const ROTATION_MS = 3500;
const SLIDE_MS = 700;
const CARD_H = 54; // card height in px
const GAP = 8; // gap between cards in px
const SLOT = CARD_H + GAP;

/**
 * Wheel-style feed: 3 visible cards with the CENTER card highlighted.
 * On each tick, all cards slide up by one slot. The top card exits,
 * a new card enters from below, and the new center inherits the glow.
 */
export function InsightFeed() {
  // `center` = the INSIGHTS index currently in the center position
  const [center, setCenter] = useState(0);
  const [sliding, setSliding] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const advance = useCallback(() => {
    // Phase 1: start sliding up
    setSliding(true);
    // Phase 2: after slide completes, snap back and update center
    timerRef.current = setTimeout(() => {
      setSliding(false);
      setCenter((c) => (c + 1) % INSIGHTS.length);
    }, SLIDE_MS);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const id = setInterval(advance, ROTATION_MS);
    return () => {
      clearInterval(id);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [paused, reducedMotion, advance]);

  // We render 4 cards: [center-1, center, center+1, center+2]
  // Normally the container shows the first 3 (top, center, bottom).
  // During slide, the track translates up by one SLOT so card[3] enters
  // and card[0] exits. After the slide, we increment center and reset.
  const wrap = (i: number) => ((i % INSIGHTS.length) + INSIGHTS.length) % INSIGHTS.length;
  const indices = [wrap(center - 1), wrap(center), wrap(center + 1), wrap(center + 2)];

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      aria-live="polite"
      aria-atomic="true"
      className="w-full max-w-xl mx-auto"
    >
      {/* Clip to 3 visible cards */}
      <div
        className="overflow-hidden relative"
        style={{ height: SLOT * 3 - GAP }}
      >
        {/* Sliding track */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: `${GAP}px`,
            transform: `translateY(${sliding ? -SLOT : 0}px)`,
            transition: sliding
              ? `transform ${SLIDE_MS}ms cubic-bezier(0.22, 0.68, 0, 1.04)`
              : 'none',
          }}
        >
          {indices.map((idx, pos) => {
            // During steady state: pos 0=top, 1=center, 2=bottom, 3=hidden below
            // During slide: pos 0=exiting top, 1=becomes top, 2=becomes center, 3=becomes bottom
            const isCenterCard = sliding ? pos === 2 : pos === 1;
            const isEdge = sliding ? (pos === 1 || pos === 3) : (pos === 0 || pos === 2);
            const isExiting = sliding && pos === 0;
            const isHidden = !sliding && pos === 3;

            let opacity = 1;
            if (isEdge) opacity = 0.45;
            if (isExiting) opacity = 0.2;
            if (isHidden) opacity = 0;

            const scale = isCenterCard ? 1 : 0.97;

            return (
              <div
                key={`pos-${pos}`}
                className={`landing-insight flex items-center justify-between gap-4 px-5 ${
                  isCenterCard ? 'landing-insight--top' : ''
                }`}
                style={{
                  height: `${CARD_H}px`,
                  opacity,
                  transform: `scale(${scale})`,
                  transition: sliding
                    ? `opacity ${SLIDE_MS}ms cubic-bezier(0.22, 0.68, 0, 1.04), transform ${SLIDE_MS}ms cubic-bezier(0.22, 0.68, 0, 1.04)`
                    : 'none',
                  flexShrink: 0,
                }}
              >
                <span
                  className="text-sm text-[var(--text-100)] flex-1 min-w-0 truncate"
                  style={{ letterSpacing: '-0.005em' }}
                >
                  {INSIGHTS[idx].text}
                  <strong className="text-[#67e8f9] font-semibold">{INSIGHTS[idx].cyan}</strong>
                  {INSIGHTS[idx].mid}
                  {INSIGHTS[idx].teal && (
                    <strong className="text-[var(--teal-400)] font-semibold">{INSIGHTS[idx].teal}</strong>
                  )}
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 rounded-full text-2xs font-semibold whitespace-nowrap select-none"
                  style={{
                    background: 'rgba(45,212,191,0.2)',
                    border: '1px solid rgba(45,212,191,0.5)',
                    color: '#2dd4bf',
                    padding: '5px 14px',
                  }}
                >
                  Approve?
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
