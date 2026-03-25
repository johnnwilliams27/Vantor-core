import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Vantor – Agentic Stablecoin Treasury Management';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #060d1f 0%, #0a1628 50%, #060d1f 100%)',
          position: 'relative',
        }}
      >
        {/* Subtle teal accent glow */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 600,
            height: 600,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(45,212,191,0.08) 0%, transparent 70%)',
          }}
        />

        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://vantor.xyz/logo-dark.png"
          alt=""
          width={360}
          height={120}
          style={{ objectFit: 'contain' }}
        />

        {/* Tagline */}
        <p
          style={{
            marginTop: 32,
            fontSize: 28,
            color: 'rgba(148, 163, 184, 0.8)',
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '0.05em',
          }}
        >
          Agentic Stablecoin Treasury Management
        </p>
      </div>
    ),
    { ...size },
  );
}
