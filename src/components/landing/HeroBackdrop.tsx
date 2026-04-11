'use client';

import { useEffect, useState } from 'react';
import { NetworkCanvas } from './NetworkCanvas';
import { BlobBackground } from './BlobBackground';

export function HeroBackdrop() {
  const [density, setDensity] = useState({ particles: 80, blur: 120 });

  useEffect(() => {
    const w = window.innerWidth;
    if (w < 768) setDensity({ particles: 30, blur: 60 });
    else if (w < 1280) setDensity({ particles: 60, blur: 100 });
    else setDensity({ particles: 80, blur: 120 });
  }, []);

  return (
    <>
      <BlobBackground blurRadius={density.blur} />
      <NetworkCanvas particleCount={density.particles} />
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
