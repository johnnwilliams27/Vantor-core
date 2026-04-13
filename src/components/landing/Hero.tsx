'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HeroBackdrop } from './HeroBackdrop';

export function Hero() {
  return (
    <section className="relative flex items-center justify-center overflow-hidden pt-36 pb-[82px] lg:pt-44 lg:pb-[114px] bg-[var(--bg-void)]">
      <HeroBackdrop />

      <div className="relative z-10 max-w-[var(--container-wide)] mx-auto text-center px-6">
        <h1
          className="font-extrabold leading-[1.06] landing-fade-in landing-delay-1 text-white text-balance"
          style={{
            fontFamily: 'var(--font-display), Satoshi, sans-serif',
            fontSize: 'clamp(2.25rem, 1.5rem + 3.5vw, 4rem)',
            letterSpacing: '-0.032em',
          }}
        >
          Put Your Idle Treasury
          <br />
          <span className="bg-gradient-to-r from-teal-400 to-cyan-300 bg-clip-text text-transparent">
            Reserves to Work
          </span>
        </h1>

        <p className="mt-6 text-base sm:text-lg text-[var(--text-300)] max-w-[620px] mx-auto leading-relaxed landing-fade-in landing-delay-2 text-pretty">
          Vantor provides full visibility across your cash and stablecoin reserves. Powerful AI&nbsp;insights assess upcoming obligations while surfacing yield opportunities and hedging FX&nbsp;exposure — always with a human&nbsp;in&nbsp;the&nbsp;loop.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 landing-fade-in landing-delay-3">
          <Link
            href="/register"
            className="group w-full sm:w-auto min-h-[52px] px-10 py-4 text-base font-semibold rounded-lg bg-white text-[var(--bg-void)] shadow-[0_4px_16px_rgba(0,0,0,0.3)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.4)] hover:-translate-y-px active:scale-[0.98] transition-all duration-200 flex items-center justify-center"
          >
            Get Started Free
            <ArrowRight size={16} aria-hidden="true" className="inline ml-2 group-hover:translate-x-0.5 transition-transform duration-200" />
          </Link>
          <a
            href="#platform"
            className="w-full sm:w-auto min-h-[48px] px-8 py-3.5 rounded-full text-sm font-medium text-[var(--text-200)] border border-white/[0.16] hover:border-white/30 hover:bg-white/[0.04] transition-[border-color,background] duration-200 flex items-center justify-center"
          >
            Explore Platform
          </a>
        </div>
      </div>
    </section>
  );
}
