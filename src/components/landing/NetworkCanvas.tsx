'use client';

import { useEffect, useRef } from 'react';

/**
 * Ambient particle field — simplified from the original NetworkCanvas.
 * No labeled nodes, no mesh edges, no wave pulses.
 * Just ~25 small teal dots drifting slowly. Pure atmosphere.
 */
export function NetworkCanvas({ particleCount = 25 }: { particleCount?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    interface Dot {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      alpha: number;
      pulse: number;
      pulseSpeed: number;
    }

    let dots: Dot[] = [];
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement!.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Initialize dots spread across the canvas
      dots = [];
      for (let i = 0; i < particleCount; i++) {
        dots.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15,
          r: 1.5 + Math.random() * 2,
          alpha: 0.15 + Math.random() * 0.35,
          pulse: Math.random() * Math.PI * 2,
          pulseSpeed: 0.008 + Math.random() * 0.012,
        });
      }
    };

    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      for (const d of dots) {
        // Drift
        d.x += d.vx;
        d.y += d.vy;
        d.pulse += d.pulseSpeed;

        // Wrap around edges
        if (d.x < -10) d.x = w + 10;
        if (d.x > w + 10) d.x = -10;
        if (d.y < -10) d.y = h + 10;
        if (d.y > h + 10) d.y = -10;

        const pulseAlpha = d.alpha * (0.7 + 0.3 * Math.sin(d.pulse));
        const pulseR = d.r * (0.9 + 0.1 * Math.sin(d.pulse));

        // Soft glow
        const grad = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, pulseR * 6);
        grad.addColorStop(0, `rgba(45, 212, 191, ${pulseAlpha * 0.3})`);
        grad.addColorStop(1, 'rgba(45, 212, 191, 0)');
        ctx.beginPath();
        ctx.arc(d.x, d.y, pulseR * 6, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(d.x, d.y, pulseR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 212, 191, ${pulseAlpha})`;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [particleCount]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none opacity-90"
      aria-hidden="true"
    />
  );
}
