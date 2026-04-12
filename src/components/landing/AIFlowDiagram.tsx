'use client';

import Image from 'next/image';

const INPUTS = ['Upcoming AR/AP', 'Banks + Wallets', 'Treasury Policy', 'FX Exposure'];
const OUTPUTS = ['Spiko USD', 'Circle USYC', 'FX Rebalance', 'Payments'];

export function AIFlowDiagram() {
  return (
    <div className="relative">
      <div className="hidden lg:block">
        <DesktopDiagram />
      </div>
      <div className="lg:hidden">
        <MobileDiagram />
      </div>
    </div>
  );
}

/**
 * Desktop diagram — v4:
 *   - Pills at original text-sm size, fixed 200px width, pushed to edges
 *   - Lines: horizontal out of the pill, then angle cleanly to the orb ring
 *   - Lines connect to pill's inner edge (right for inputs, left for outputs)
 *     and terminate at the orb ring — never overlap the pill or cross into the orb
 */
function DesktopDiagram() {
  // Layout constants (match CSS flex layout in the 920px container)
  const orbX = 460;
  const orbY = 128;
  const orbR = 80;
  const chipW = 200;

  // justify-between with px-8 (32px each side): pills at 32px and 688px from left
  const pad = 32;
  const inRight = pad + chipW; // 232
  const outLeft = 920 - pad - chipW; // 688

  // Horizontal run before angling to the orb
  const inMidX = inRight + 60;
  const outMidX = outLeft - 60;

  // Vertical centers of each pill (4 pills, 54px each, 10px gap → total ~246px)
  // viewBox height 256 to accommodate
  const chipYs = [32, 96, 160, 224];

  // Where each angled line meets the orb ring
  const ringPoint = (fromX: number, fromY: number) => {
    const dx = orbX - fromX;
    const dy = orbY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    return {
      x: Math.round((orbX - (orbR * dx) / len) * 10) / 10,
      y: Math.round((orbY - (orbR * dy) / len) * 10) / 10,
    };
  };
  const ringPointFrom = (toX: number, toY: number) => {
    const dx = toX - orbX;
    const dy = toY - orbY;
    const len = Math.sqrt(dx * dx + dy * dy);
    return {
      x: Math.round((orbX + (orbR * dx) / len) * 10) / 10,
      y: Math.round((orbY + (orbR * dy) / len) * 10) / 10,
    };
  };

  // Input paths: horizontal from pill edge → midpoint, then angle to ring
  const inputPaths = chipYs.map((y) => {
    const ring = ringPoint(inMidX, y);
    return `M ${inRight} ${y} H ${inMidX} L ${ring.x} ${ring.y}`;
  });

  // Output paths: from ring → angle to midpoint, then horizontal to pill edge
  const outputPaths = chipYs.map((y) => {
    const ring = ringPointFrom(outMidX, y);
    return `M ${ring.x} ${ring.y} L ${outMidX} ${y} H ${outLeft}`;
  });

  return (
    <div className="relative max-w-[920px] mx-auto" style={{ minHeight: '256px' }}>
      {/* SVG layer: lines + particles — BEHIND chips via z-index */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 920 256"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        style={{ zIndex: 1 }}
      >
        {/* Connector lines — horizontal segment then angled to ring */}
        {inputPaths.map((d, i) => (
          <path
            key={`in-line-${i}`}
            d={d}
            fill="none"
            stroke="rgba(45,212,191,0.25)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        ))}
        {outputPaths.map((d, i) => (
          <path
            key={`out-line-${i}`}
            d={d}
            fill="none"
            stroke="rgba(103,232,249,0.25)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        ))}

        {/* Input particles — 1 per path, slow */}
        {inputPaths.map((d, i) => (
          <circle key={`in-p-${i}`} r="3" fill="#67e8f9" opacity="0.75">
            <animateMotion dur="3.5s" repeatCount="indefinite" begin={`${i * 0.8}s`} path={d} />
          </circle>
        ))}

        {/* Output particles — 1 per path, slow */}
        {outputPaths.map((d, i) => (
          <circle key={`out-p-${i}`} r="3" fill="#a5f3fc" opacity="0.75">
            <animateMotion dur="3.5s" repeatCount="indefinite" begin={`${i * 0.8 + 0.4}s`} path={d} />
          </circle>
        ))}
      </svg>

      {/* Flex row: chips | orb | chips — ABOVE lines, scooted inward */}
      <div className="relative flex items-center justify-between px-8" style={{ zIndex: 2 }}>
        {/* Input chips */}
        <div className="flex flex-col gap-2.5" style={{ width: `${chipW}px` }}>
          {INPUTS.map((label) => (
            <div
              key={label}
              className="landing-card px-5 text-sm font-medium text-[var(--text-100)] whitespace-nowrap flex items-center justify-center"
              style={{ height: '54px', letterSpacing: '-0.005em' }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Central orb with logo + text */}
        <div
          className="shrink-0 relative"
          style={{ width: '160px', height: '160px', zIndex: 3 }}
        >
          {/* Pulsing ring — scales independently */}
          <div
            className="landing-orb absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(45,212,191,0.35), rgba(45,212,191,0.06) 70%)',
              border: '1.5px solid rgba(45,212,191,0.45)',
            }}
          />
          {/* Static content — no pulse */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <Image
              src="/vantor-icon-white.png"
              alt="Vantor AI"
              width={48}
              height={48}
              className="opacity-80"
              unoptimized
            />
            <span
              className="text-white font-semibold mt-1.5"
              style={{ fontSize: '15px', letterSpacing: '-0.01em', opacity: 0.9 }}
            >
              Vantor AI
            </span>
          </div>
        </div>

        {/* Output chips */}
        <div className="flex flex-col gap-2.5" style={{ width: `${chipW}px` }}>
          {OUTPUTS.map((label) => (
            <div
              key={label}
              className="landing-card px-5 text-sm font-medium text-[var(--text-100)] whitespace-nowrap flex items-center justify-center"
              style={{ height: '54px', letterSpacing: '-0.005em' }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileDiagram() {
  return (
    <div className="relative max-w-md mx-auto py-4">
      <div className="grid grid-cols-2 gap-2.5 mb-6">
        {INPUTS.map((label) => (
          <div
            key={label}
            className="landing-card px-3 py-2.5 text-xs text-[var(--text-100)] text-center"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="relative h-12 flex items-center justify-center">
        <div
          className="absolute w-0.5 h-full"
          style={{
            background: 'linear-gradient(to bottom, transparent, var(--teal-400), transparent)',
            animation: 'aiFlowBeam 2.4s ease-in-out infinite',
          }}
        />
      </div>

      <div className="flex items-center justify-center my-2">
        <div
          className="landing-orb w-28 h-28 rounded-full flex flex-col items-center justify-center"
          style={{
            background:
              'radial-gradient(circle, rgba(45,212,191,0.35), rgba(45,212,191,0.06) 70%)',
            border: '1.5px solid rgba(45,212,191,0.45)',
          }}
        >
          <Image
            src="/vantor-icon-white.png"
            alt="Vantor AI"
            width={36}
            height={36}
            className="opacity-80"
            unoptimized
          />
          <span
            className="text-white font-semibold mt-1"
            style={{ fontSize: '11px', letterSpacing: '-0.01em', opacity: 0.9 }}
          >
            Vantor AI
          </span>
        </div>
      </div>

      <div className="relative h-12 flex items-center justify-center">
        <div
          className="absolute w-0.5 h-full"
          style={{
            background: 'linear-gradient(to bottom, transparent, var(--cyan-300), transparent)',
            animation: 'aiFlowBeam 2.4s ease-in-out infinite 1.2s',
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5 mt-6">
        {OUTPUTS.map((label) => (
          <div
            key={label}
            className="landing-card px-3 py-2.5 text-xs text-[var(--text-100)] text-center"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
