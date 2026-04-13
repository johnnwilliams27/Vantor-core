'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';

type Slide = {
  label: string;
  title: string;
  body: string;
  bullets: string[];
  screenshot: string;
};

const SLIDES: Slide[] = [
  {
    label: 'Dashboard',
    title: 'Dashboard',
    body: 'Real-time visibility across every bank, wallet, and protocol — with AI insights surfaced the moment they matter.',
    bullets: ['Cash Visibility', 'AI Insights', 'Asset Management', 'AI Agent Chat'],
    screenshot: '/screenshots/dashboard.png',
  },
  {
    label: 'Treasury',
    title: 'Treasury',
    body: 'AI-drafted moves on your balances and obligations, queued with full reasoning. You approve, edit, or reject — nothing executes without a human in the loop.',
    bullets: ['AI Treasury Rules', 'Payments Operations', 'Approval Workflows', 'FX Rebalancing'],
    screenshot: '/screenshots/treasury-ai.png',
  },
  {
    label: 'Yield',
    title: 'Yield',
    body: 'Tokenized MMFs and on-chain protocols side-by-side on one rate board. Slippage, risk scores, and one-click deposits — no DeFi expertise required.',
    bullets: ['Tokenized MMFs', 'DeFi Yield Protocols', 'AI Risk Management', 'AI Yield Insights'],
    screenshot: '/screenshots/yield.png',
  },
];

const SLIDE_SLUGS = ['dashboard', 'treasury', 'yield'] as const;

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
              <ProductScreenshot key={`shot-${active}`} slide={slide} />
              <SlideCopy key={`copy-${active}`} slide={slide} />
            </div>
            {/* Mobile stacked */}
            <div className="lg:hidden space-y-10">
              <SlideCopy key={`m-copy-${active}`} slide={slide} />
              <ProductScreenshot key={`m-shot-${active}`} slide={slide} />
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
              className="rounded-full transition-[width,background-color] duration-300"
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
            <Check className="h-4 w-4 text-[var(--teal-400)] shrink-0" aria-hidden="true" strokeWidth={2.5} />
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductScreenshot({ slide }: { slide: Slide }) {
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
        className="rounded-2xl overflow-hidden border border-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <Image
          src={slide.screenshot}
          alt={`Vantor ${slide.label} screenshot`}
          width={960}
          height={600}
          className="w-full h-auto"
          quality={90}
          priority
          unoptimized
        />
      </div>
    </div>
  );
}
