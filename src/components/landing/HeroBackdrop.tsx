'use client';

import { useEffect, useState } from 'react';
import { NetworkCanvas } from './NetworkCanvas';
import { BlobBackground } from './BlobBackground';

export function HeroBackdrop() {
  const [particles, setParticles] = useState(25);

  useEffect(() => {
    const w = window.innerWidth;
    if (w < 768) setParticles(12);
    else if (w < 1280) setParticles(20);
    else setParticles(25);
  }, []);

  return (
    <>
      <BlobBackground />
      <NetworkCanvas particleCount={particles} />
      <div
        className="absolute inset-0 z-[5] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 50% 40% at 50% 50%, rgba(6,13,31,0.25) 0%, rgba(6,13,31,0) 100%)',
        }}
        aria-hidden
      />
    </>
  );
}
