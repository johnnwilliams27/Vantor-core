'use client';

import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const SLIDES = [
  {
    eyebrow: 'COMMAND CENTER',
    title: 'Every account, every chain, one view',
    body: 'Bank balances, wallet positions, yield deployments, and pending obligations rendered as a single live treasury picture. Drill into any line for full transaction history.',
  },
  {
    eyebrow: 'TREASURY',
    title: 'AI-drafted moves, human-approved',
    body: 'Vantor watches your balances and obligations and queues recommended moves with full reasoning. You approve, edit, or reject — nothing executes without a human in the loop.',
  },
  {
    eyebrow: 'YIELD',
    title: 'Tokenized MMFs and on-chain protocols, side by side',
    body: 'Compare Spiko USD, Circle USYC, Aave, Morpho and more on a single rate board. Slippage estimates, risk scores, and one-click deposit flows — no DeFi expertise required.',
  },
];

export function FeatureCarousel() {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  const goto = (i: number) => setActive(((i % SLIDES.length) + SLIDES.length) % SLIDES.length);
  const next = () => goto(active + 1);
  const prev = () => goto(active - 1);

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

  return (
    <section className="relative py-24 lg:py-32" style={{ background: 'var(--bg-deep-navy)' }}>
      <div className="max-w-7xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-16 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          See it in action
        </h2>

        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="relative"
        >
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Text column */}
            <div key={`text-${active}`} className="landing-fade-in">
              <p className="text-xs font-medium text-[var(--teal-400)] tracking-[0.12em] uppercase mb-3">
                {SLIDES[active].eyebrow}
              </p>
              <h3
                className="text-2xl lg:text-3xl font-semibold text-white mb-4 leading-tight"
                style={{ letterSpacing: '-0.015em' }}
              >
                {SLIDES[active].title}
              </h3>
              <p className="text-base text-[var(--text-300)] leading-relaxed">{SLIDES[active].body}</p>
            </div>

            {/* Mockup frame — v1 placeholder, real screenshots are a follow-up */}
            <div className="relative">
              <div
                className="absolute inset-0 rounded-2xl"
                style={{
                  background:
                    'radial-gradient(ellipse at center, rgba(45,212,191,0.12) 0%, transparent 70%)',
                  filter: 'blur(40px)',
                }}
                aria-hidden
              />
              <div
                className="relative rounded-xl border border-white/[0.08] bg-white/[0.02] aspect-[16/10] flex items-center justify-center text-[var(--text-400)] text-sm overflow-hidden"
                style={{
                  boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
              >
                <div className="p-6 text-xs text-[var(--text-300)]">
                  [{SLIDES[active].eyebrow} mockup placeholder]
                </div>
              </div>
            </div>
          </div>

          {/* Slide arrows — visible at lg+ only */}
          <button
            onClick={prev}
            aria-label="Previous slide"
            className="hidden lg:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 w-12 h-12 items-center justify-center rounded-full border border-white/10 text-[var(--text-200)] hover:border-white/25 hover:text-white transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={next}
            aria-label="Next slide"
            className="hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 w-12 h-12 items-center justify-center rounded-full border border-white/10 text-[var(--text-200)] hover:border-white/25 hover:text-white transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Dot nav — all viewports, 24x24 hit area with 8x8 visible dot */}
        <div className="flex items-center justify-center gap-3 mt-12">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => goto(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === active ? 'true' : undefined}
              className="w-6 h-6 flex items-center justify-center group"
            >
              <span
                className={`block w-2 h-2 rounded-full transition-colors ${
                  i === active ? 'bg-[var(--teal-400)]' : 'bg-white/20 group-hover:bg-white/40'
                }`}
              />
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-[var(--text-300)] mt-4">
          {active + 1} / {SLIDES.length}
        </p>
      </div>
    </section>
  );
}
