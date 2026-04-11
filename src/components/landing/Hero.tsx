'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HeroBackdrop } from './HeroBackdrop';

export function Hero() {
  return (
    <section className="relative flex items-center justify-center overflow-hidden min-h-screen pt-32 pb-20 lg:pt-40 lg:pb-32 bg-[var(--bg-void)]">
      <HeroBackdrop />

      <div className="relative z-10 max-w-5xl mx-auto text-center px-6">
        <h1
          className="font-bold tracking-tight leading-[1.08] landing-fade-in landing-delay-1 text-white"
          style={{ fontSize: 'clamp(2.25rem, 1.5rem + 3.5vw, 4rem)', letterSpacing: '-0.028em' }}
        >
          Put Your Idle Treasury
          <br />
          <span className="bg-gradient-to-r from-teal-400 via-cyan-300 to-teal-400 bg-clip-text text-transparent">
            Reserves to Work
          </span>
        </h1>

        <p className="mt-6 text-base sm:text-lg lg:text-xl text-[var(--text-300)] max-w-2xl mx-auto leading-relaxed landing-fade-in landing-delay-2">
          Vantor provides full visibility across your cash and stablecoin reserves. Powerful AI insights assess upcoming obligations while surfacing yield opportunities and hedging FX exposure — always with a human in the loop.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 landing-fade-in landing-delay-3">
          <Link
            href="/register"
            className="group w-full sm:w-auto min-h-[48px] px-8 py-3.5 rounded-full text-base font-semibold bg-gradient-to-r from-teal-500 to-cyan-400 text-white hover:shadow-[0_0_32px_rgba(45,212,191,0.4)] transition-all duration-500 flex items-center justify-center"
          >
            Get Started Free
            <ArrowRight size={16} className="inline ml-2 group-hover:translate-x-1 transition-transform" />
          </Link>
          <a
            href="#platform"
            className="w-full sm:w-auto min-h-[48px] px-8 py-3.5 rounded-full text-base font-medium text-[var(--text-200)] border border-white/10 hover:border-white/25 hover:bg-white/5 transition-all duration-300 flex items-center justify-center"
          >
            Explore Platform
          </a>
        </div>
      </div>
    </section>
  );
}
