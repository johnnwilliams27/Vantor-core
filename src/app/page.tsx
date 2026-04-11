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
      <Navbar />
      <main>
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
