'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Slide = {
  label: string;
  title: string;
  body: string;
  bullets: string[];
  mockup: {
    kpis: { label: string; value: string; accent?: boolean }[];
    ai: string;
  };
};

const SLIDES: Slide[] = [
  {
    label: 'Command Center',
    title: 'Command Center',
    body: 'Real-time visibility across every bank, wallet, and protocol — with AI insights surfaced the moment they matter.',
    bullets: ['Cash Visibility', 'AI Insights', 'Asset Management', 'AI Agent Chat'],
    mockup: {
      kpis: [
        { label: 'TOTAL AUM', value: '$24.8M', accent: true },
        { label: 'IDLE CASH', value: '$2.3M' },
        { label: 'YIELD EARNED', value: '$127K' },
      ],
      ai: '$2.3M idle → Spiko USD · +4.9% APY',
    },
  },
  {
    label: 'Treasury',
    title: 'Treasury',
    body: 'AI-drafted moves on your balances and obligations, queued with full reasoning. You approve, edit, or reject — nothing executes without a human in the loop.',
    bullets: ['AI Treasury Rules', 'Payments Operations', 'Approval Workflows', 'FX Rebalancing'],
    mockup: {
      kpis: [
        { label: 'TOTAL AUM', value: '$24.8M' },
        { label: 'PENDING', value: '$4.5M', accent: true },
        { label: 'APPROVED', value: '$18.1M' },
      ],
      ai: '$2.8M quarterly tax → Schedule USD payment',
    },
  },
  {
    label: 'Yield',
    title: 'Yield',
    body: 'Tokenized MMFs and on-chain protocols side-by-side on one rate board. Slippage, risk scores, and one-click deposits — no DeFi expertise required.',
    bullets: ['Tokenized MMFs', 'DeFi Yield Protocols', 'AI Risk Management', 'AI Yield Insights'],
    mockup: {
      kpis: [
        { label: 'TOTAL AUM', value: '$24.8M' },
        { label: 'IDLE CASH', value: '$2.3M' },
        { label: 'YIELD EARNED', value: '$127K', accent: true },
      ],
      ai: '$1.2M Spiko USD · 4.9% → Circle USYC · +5.1% APY',
    },
  },
];

const SLIDE_SLUGS = ['command-center', 'treasury', 'yield'] as const;

function getInitialSlide(): number {
  if (typeof window === 'undefined') return 0;
  const param = new URLSearchParams(window.location.search).get('slide');
  if (!param) return 0;
  const idx = SLIDE_SLUGS.indexOf(param as typeof SLIDE_SLUGS[number]);
  return idx >= 0 ? idx : 0;
}

export function FeatureCarousel() {
  const [active, setActive] = useState(getInitialSlide);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  // Sync slide index to URL param without triggering navigation
  const syncUrl = useCallback((i: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set('slide', SLIDE_SLUGS[i]);
    window.history.replaceState({}, '', url.toString());
  }, []);

  const goto = (i: number) => {
    const idx = ((i % SLIDES.length) + SLIDES.length) % SLIDES.length;
    setActive(idx);
    syncUrl(idx);
  };
  const next = () => goto(active + 1);
  const prev = () => goto(active - 1);

  // Handle browser back/forward
  useEffect(() => {
    const onPop = () => {
      const param = new URLSearchParams(window.location.search).get('slide');
      if (!param) return;
      const idx = SLIDE_SLUGS.indexOf(param as typeof SLIDE_SLUGS[number]);
      if (idx >= 0) setActive(idx);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };
  const onTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    const dx = touchEndX.current - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) next();
      else prev();
    }
    touchStartX.current = null;
    touchEndX.current = null;
  };

  const slide = SLIDES[active];

  return (
    <section
      className="relative py-[70px] lg:py-[102px] overflow-hidden"
      style={{ background: 'var(--bg-deep-navy)' }}
    >
      {/* Subtle teal blooms — corners only */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '500px',
          height: '500px',
          left: '-8%',
          top: '20%',
          background: 'radial-gradient(circle, rgba(45,212,191,0.12), transparent 70%)',
          filter: 'blur(80px)',
          opacity: 0.35,
        }}
        aria-hidden
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: '420px',
          height: '420px',
          right: '-6%',
          bottom: '0%',
          background: 'radial-gradient(circle, rgba(103,232,249,0.1), transparent 70%)',
          filter: 'blur(80px)',
          opacity: 0.3,
        }}
        aria-hidden
      />

      <div className="relative max-w-[var(--container-wide)] mx-auto px-6">
        <p
          className="text-center text-[13px] font-semibold uppercase text-[var(--teal-400)] mb-4"
          style={{ letterSpacing: '0.12em' }}
        >
          See it in action
        </p>
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-4 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Built for treasury, designed for everyone
        </h2>
        <p
          className="text-center text-base text-[var(--text-300)] max-w-[540px] mx-auto mb-16 leading-relaxed"
          style={{ letterSpacing: '-0.005em' }}
        >
          Three products. One platform. Total treasury visibility.
        </p>

        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="relative max-w-[960px] mx-auto"
        >
          <div
            className="grid gap-10 items-center"
            style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
          >
            <div className="hidden lg:grid gap-10 items-center" style={{ gridTemplateColumns: '58% 42%' }}>
              <DashboardMockup key={`mockup-${active}`} slide={slide} />
              <SlideCopy key={`copy-${active}`} slide={slide} />
            </div>
            {/* Mobile stacked */}
            <div className="lg:hidden space-y-10">
              <SlideCopy key={`m-copy-${active}`} slide={slide} />
              <DashboardMockup key={`m-mockup-${active}`} slide={slide} />
            </div>
          </div>

          {/* Slide arrows — visible at lg+ only */}
          <button
            onClick={prev}
            aria-label="Previous slide"
            className="hidden lg:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-14 w-11 h-11 items-center justify-center rounded-full border border-white/10 text-[var(--text-200)] hover:border-white/25 hover:text-white transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={next}
            aria-label="Next slide"
            className="hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-14 w-11 h-11 items-center justify-center rounded-full border border-white/10 text-[var(--text-200)] hover:border-white/25 hover:text-white transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Dot nav */}
        <div className="flex items-center justify-center gap-2 mt-10">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => goto(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === active ? 'true' : undefined}
              className="rounded-full transition-all duration-300"
              style={{
                width: i === active ? '28px' : '8px',
                height: '8px',
                background: i === active ? 'var(--teal-400)' : 'rgba(255,255,255,0.25)',
              }}
            />
          ))}
        </div>

      </div>
    </section>
  );
}

function SlideCopy({ slide }: { slide: Slide }) {
  return (
    <div className="landing-fade-in">
      <h3
        className="text-xl lg:text-2xl font-semibold text-white mb-2.5"
        style={{ letterSpacing: '-0.015em' }}
      >
        {slide.title}
      </h3>
      <p
        className="text-[13px] lg:text-sm text-[var(--text-300)] leading-relaxed mb-5"
        style={{ letterSpacing: '-0.005em' }}
      >
        {slide.body}
      </p>
      <ul className="flex flex-col gap-2">
        {slide.bullets.map((b) => (
          <li
            key={b}
            className="text-[13px] text-[var(--text-200)] flex items-center gap-2.5"
            style={{ letterSpacing: '-0.005em' }}
          >
            <span className="text-[var(--teal-400)] font-bold">✓</span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Dashboard-style mockup inside a card frame. Mirrors the HTML preview's
 * fake Command Center screenshot — dots bar, KPI row, AI strip, charts —
 * so the carousel feels like a product preview, not an empty placeholder.
 */
function DashboardMockup({ slide }: { slide: Slide }) {
  return (
    <div className="relative landing-fade-in">
      <div
        className="absolute -inset-8 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(45,212,191,0.22), transparent 70%)',
          filter: 'blur(40px)',
        }}
        aria-hidden
      />
      <div
        className="landing-card p-[18px]"
        style={{ background: 'var(--bg-elevated)' }}
      >
        {/* Dots header */}
        <div className="flex items-center gap-1.5 mb-3.5">
          <span className="w-2 h-2 rounded-full bg-white/[0.14]" />
          <span className="w-2 h-2 rounded-full bg-white/[0.14]" />
          <span className="w-2 h-2 rounded-full bg-white/[0.14]" />
          <span
            className="ml-2.5 text-[10px] uppercase text-[var(--text-300)]"
            style={{ letterSpacing: '0.02em' }}
          >
            {slide.label}
          </span>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-2.5 mb-3">
          {slide.mockup.kpis.map((kpi) => (
            <MockKpi key={kpi.label} label={kpi.label} value={kpi.value} accent={kpi.accent} />
          ))}
        </div>

        {/* AI strip */}
        <div
          className="flex items-center gap-2.5 px-3 py-3 rounded-[10px] mb-3"
          style={{
            border: '1px solid rgba(45,212,191,0.35)',
            background: 'rgba(45,212,191,0.06)',
          }}
        >
          <span
            className="landing-orb w-[18px] h-[18px] rounded-full shrink-0"
            style={{ background: 'rgba(45,212,191,0.3)' }}
          />
          <span className="flex-1 text-[11px] text-[var(--text-100)] leading-[1.4]">
            <strong className="text-[var(--teal-400)]">AI:</strong> {slide.mockup.ai}
          </span>
          <span
            className="text-[9px] font-semibold rounded-full px-2 py-0.5"
            style={{
              color: 'var(--teal-400)',
              border: '1px solid rgba(45,212,191,0.45)',
            }}
          >
            Approve?
          </span>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-2.5">
          <div
            className="p-2.5 rounded-[8px]"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div
              className="text-[9px] uppercase text-[var(--text-300)] mb-2"
              style={{ letterSpacing: '0.03em' }}
            >
              BALANCES
            </div>
            <div className="h-[5px] rounded-[3px] mb-1.5" style={{ background: 'rgba(45,212,191,0.4)' }} />
            <div className="h-[5px] rounded-[3px] mb-1.5 w-[72%]" style={{ background: 'rgba(45,212,191,0.28)' }} />
            <div className="h-[5px] rounded-[3px] w-[48%]" style={{ background: 'rgba(45,212,191,0.18)' }} />
          </div>
          <div
            className="p-2.5 rounded-[8px]"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div
              className="text-[9px] uppercase text-[var(--text-300)] mb-2"
              style={{ letterSpacing: '0.03em' }}
            >
              FLOWS
            </div>
            <div className="flex items-end gap-[3px] h-9">
              {[60, 85, 45, 90, 68, 52].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-[2px]"
                  style={{
                    height: `${h}%`,
                    background:
                      'linear-gradient(180deg, rgba(45,212,191,0.5), rgba(45,212,191,0.15))',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockKpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className="p-3 rounded-[8px]"
      style={{
        border: `1px solid ${accent ? 'rgba(45,212,191,0.3)' : 'rgba(255,255,255,0.08)'}`,
        background: accent ? 'rgba(45,212,191,0.05)' : 'transparent',
      }}
    >
      <div
        className="text-[9px] uppercase text-[var(--text-300)] mb-1 font-medium"
        style={{ letterSpacing: '0.04em' }}
      >
        {label}
      </div>
      <div
        className="text-[18px] font-bold"
        style={{
          letterSpacing: '-0.02em',
          color: accent ? 'var(--teal-400)' : '#fff',
        }}
      >
        {value}
      </div>
    </div>
  );
}
