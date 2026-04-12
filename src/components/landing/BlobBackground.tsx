'use client';

/**
 * Static gradient mesh backdrop for the hero section.
 * Replaces the 3 animated blur-blobs with two offset radial gradients —
 * same atmospheric teal/cyan depth, no animation, no filter: blur().
 * The NetworkCanvas provides all the motion this section needs.
 */
export function BlobBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {/* Primary teal wash — upper left, large */}
      <div
        className="absolute"
        style={{
          width: '120%',
          height: '120%',
          top: '-20%',
          left: '-15%',
          background:
            'radial-gradient(ellipse 60% 50% at 35% 40%, rgba(45,212,191,0.14) 0%, transparent 70%)',
        }}
      />
      {/* Secondary cyan wash — lower right, smaller */}
      <div
        className="absolute"
        style={{
          width: '100%',
          height: '100%',
          bottom: '-10%',
          right: '-10%',
          background:
            'radial-gradient(ellipse 50% 45% at 65% 60%, rgba(103,232,249,0.08) 0%, transparent 70%)',
        }}
      />
    </div>
  );
}
