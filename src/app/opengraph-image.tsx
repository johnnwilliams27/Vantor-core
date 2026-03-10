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
          background: '#0a2a2b',
          position: 'relative',
        }}
      >
        {/* Radial glow behind the logo */}
        <div
          style={{
            position: 'absolute',
            top: '42%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 700,
            height: 700,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(32,118,121,0.5) 0%, rgba(32,118,121,0.2) 35%, transparent 70%)',
          }}
        />

        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://www.vantor.xyz/logo-dark.png"
          alt=""
          width={360}
          height={120}
          style={{ objectFit: 'contain', position: 'relative' }}
        />

        {/* Tagline */}
        <p
          style={{
            marginTop: 32,
            fontSize: 28,
            color: 'rgba(255, 255, 255, 0.85)',
            fontFamily: 'system-ui, sans-serif',
            letterSpacing: '0.05em',
            position: 'relative',
          }}
        >
          Agentic Stablecoin Treasury Management
        </p>
      </div>
    ),
    { ...size },
  );
}
