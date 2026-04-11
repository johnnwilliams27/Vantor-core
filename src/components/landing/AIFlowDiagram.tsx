'use client';

const INPUTS = ['Upcoming AR/AP', 'Cash · Banks + Wallets', 'Treasury Policy', 'FX Exposure'];
const OUTPUTS = ['Spiko USD', 'Circle USYC', 'FX Rebalance', 'Payments'];

export function AIFlowDiagram() {
  return (
    <div className="relative">
      {/* Desktop layout — visible at lg+ */}
      <div className="hidden lg:block">
        <DesktopDiagram />
      </div>
      {/* Mobile fallback — visible below lg */}
      <div className="lg:hidden">
        <MobileDiagram />
      </div>
    </div>
  );
}

function DesktopDiagram() {
  const W = 900;
  const H = 480;
  const orbX = W / 2;
  const orbY = H / 2;
  const inputX = 80;
  const outputX = W - 80;
  const chipYs = [80, 180, 280, 380];

  // Quadratic curves so particle motion looks like flow, not a straight line.
  const inputPaths = chipYs.map(
    (y) => `M ${inputX + 90} ${y} Q ${(inputX + orbX) / 2} ${(y + orbY) / 2 - 20}, ${orbX - 50} ${orbY}`
  );
  const outputPaths = chipYs.map(
    (y) => `M ${orbX + 50} ${orbY} Q ${(orbX + outputX) / 2} ${(orbY + y) / 2 + 20}, ${outputX - 90} ${y}`
  );

  return (
    <div className="relative w-full max-w-[900px] mx-auto" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        {/* Paths */}
        {inputPaths.map((d, i) => (
          <path key={`in-${i}`} d={d} fill="none" stroke="rgba(45,212,191,0.15)" strokeWidth="1" />
        ))}
        {outputPaths.map((d, i) => (
          <path key={`out-${i}`} d={d} fill="none" stroke="rgba(45,212,191,0.15)" strokeWidth="1" />
        ))}

        {/* Particles — 2 per path, staggered */}
        {inputPaths.map((d, i) => (
          <g key={`in-particles-${i}`}>
            <circle r="3" fill="#2dd4bf">
              <animateMotion dur="2s" repeatCount="indefinite" begin={`${i * 0.3}s`} path={d} />
            </circle>
            <circle r="2" fill="#67e8f9" opacity="0.7">
              <animateMotion dur="2s" repeatCount="indefinite" begin={`${i * 0.3 + 1}s`} path={d} />
            </circle>
          </g>
        ))}
        {outputPaths.map((d, i) => (
          <g key={`out-particles-${i}`}>
            <circle r="3" fill="#2dd4bf">
              <animateMotion dur="2s" repeatCount="indefinite" begin={`${i * 0.3 + 0.5}s`} path={d} />
            </circle>
            <circle r="2" fill="#67e8f9" opacity="0.7">
              <animateMotion dur="2s" repeatCount="indefinite" begin={`${i * 0.3 + 1.5}s`} path={d} />
            </circle>
          </g>
        ))}

        {/* Central orb */}
        <g>
          <circle
            cx={orbX}
            cy={orbY}
            r="50"
            fill="rgba(45,212,191,0.08)"
            stroke="rgba(45,212,191,0.4)"
            strokeWidth="1.5"
          >
            <animate attributeName="r" values="48;52;48" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.6;1;0.6" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle cx={orbX} cy={orbY} r="30" fill="rgba(45,212,191,0.15)" />
          <text
            x={orbX}
            y={orbY + 5}
            textAnchor="middle"
            fontSize="14"
            fontWeight="600"
            fill="#e5e7eb"
            style={{ letterSpacing: '-0.01em' }}
          >
            Vantor AI
          </text>
        </g>
      </svg>

      {/* Input chips */}
      <div className="absolute inset-0">
        {INPUTS.map((label, i) => (
          <div
            key={label}
            className="absolute px-4 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-[var(--text-200)] whitespace-nowrap"
            style={{
              left: `${(inputX / W) * 100}%`,
              top: `${(chipYs[i] / H) * 100}%`,
              transform: 'translate(0, -50%)',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Output chips */}
      <div className="absolute inset-0">
        {OUTPUTS.map((label, i) => (
          <div
            key={label}
            className="absolute px-4 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-[var(--text-200)] whitespace-nowrap"
            style={{
              left: `${(outputX / W) * 100}%`,
              top: `${(chipYs[i] / H) * 100}%`,
              transform: 'translate(-100%, -50%)',
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileDiagram() {
  return (
    <div className="relative max-w-md mx-auto py-4">
      {/* Inputs 2x2 above */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {INPUTS.map((label) => (
          <div
            key={label}
            className="px-3 py-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-[var(--text-200)] text-center"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Beam above the orb */}
      <div className="relative h-12 flex items-center justify-center">
        <div
          className="absolute w-0.5 h-full"
          style={{
            background:
              'linear-gradient(to bottom, transparent, var(--teal-400), transparent)',
            animation: 'aiFlowBeam 2.4s ease-in-out infinite',
          }}
        />
      </div>

      {/* Orb */}
      <div className="flex items-center justify-center my-2">
        <div
          className="w-24 h-24 rounded-full border border-[var(--teal-400)]/40 flex items-center justify-center text-sm font-semibold text-[var(--text-100)]"
          style={{
            background: 'rgba(45,212,191,0.08)',
            animation: 'aiFlowOrbPulse 2.4s ease-in-out infinite',
          }}
        >
          Vantor AI
        </div>
      </div>

      {/* Beam below the orb */}
      <div className="relative h-12 flex items-center justify-center">
        <div
          className="absolute w-0.5 h-full"
          style={{
            background:
              'linear-gradient(to bottom, transparent, var(--teal-400), transparent)',
            animation: 'aiFlowBeam 2.4s ease-in-out infinite 1.2s',
          }}
        />
      </div>

      {/* Outputs 2x2 below */}
      <div className="grid grid-cols-2 gap-3 mt-6">
        {OUTPUTS.map((label) => (
          <div
            key={label}
            className="px-3 py-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs text-[var(--text-200)] text-center"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
