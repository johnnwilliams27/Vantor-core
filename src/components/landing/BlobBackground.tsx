'use client';

import type { CSSProperties } from 'react';

export function BlobBackground({ blurRadius = 100 }: { blurRadius?: number }) {
  const blobBase: CSSProperties = {
    position: 'absolute',
    borderRadius: '50%',
    filter: `blur(${blurRadius}px)`,
    opacity: 0.4,
    willChange: 'transform',
  };

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        style={{
          ...blobBase,
          width: 600,
          height: 600,
          top: '-10%',
          left: '-10%',
          background: 'radial-gradient(circle, rgba(45,212,191,0.18) 0%, transparent 70%)',
          animation: 'blobFloat1 18s ease-in-out infinite',
        }}
      />
      <div
        style={{
          ...blobBase,
          width: 500,
          height: 500,
          top: '20%',
          right: '-8%',
          background: 'radial-gradient(circle, rgba(34,211,238,0.12) 0%, transparent 70%)',
          animation: 'blobFloat2 22s ease-in-out infinite',
        }}
      />
      <div
        style={{
          ...blobBase,
          width: 400,
          height: 400,
          bottom: '-5%',
          left: '30%',
          background: 'radial-gradient(circle, rgba(45,212,191,0.10) 0%, transparent 70%)',
          animation: 'blobFloat3 20s ease-in-out infinite',
        }}
      />
    </div>
  );
}
