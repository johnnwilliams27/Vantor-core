'use client';

import {
  Navbar,
  Hero,
  AIFlow,
  CapabilityGrid,
  FeatureCarousel,
  TrustBand,
  ContactForm,
  Footer,
} from '@/components/landing';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-void)] text-white overflow-x-hidden landing-page">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-full focus:bg-[var(--teal-400)] focus:text-[var(--bg-void)] focus:font-semibold focus:text-sm"
      >
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <Hero />
        <AIFlow />
        <CapabilityGrid />
        <FeatureCarousel />
        <TrustBand />
        <ContactForm />
      </main>
      <Footer />
    </div>
  );
}
