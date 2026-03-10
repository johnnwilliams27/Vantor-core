'use client';

import { useEffect, useRef, useCallback } from 'react';

interface Node {
  x: number; y: number; vx: number; vy: number;
  radius: number; label: string; pulse: number;
}
interface Particle {
  fromIdx: number; toIdx: number; t: number; speed: number;
}

export function LoginBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Node[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const timeRef = useRef(0);

  const initNodes = useCallback((w: number, h: number) => {
    const labels = ['ERP', 'Wallet', 'Bank', 'Yield', 'FX', 'Agent', 'USDC', 'USDT', 'Audit', 'Compliance', 'Treasury', 'DeFi'];
    const cx = w / 2;
    const cy = h / 2;
    const spread = Math.min(w, h) * 0.4;
    nodesRef.current = labels.map((label, i) => {
      const angle = (i / labels.length) * Math.PI * 2 + Math.random() * 0.4;
      const dist = spread * (0.45 + Math.random() * 0.55);
      return {
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        radius: 2.5 + Math.random() * 1.5,
        label,
        pulse: Math.random() * Math.PI * 2,
      };
    });
    particlesRef.current = [];
    for (let i = 0; i < 30; i++) {
      const fromIdx = Math.floor(Math.random() * labels.length);
      let toIdx = Math.floor(Math.random() * labels.length);
      if (toIdx === fromIdx) toIdx = (toIdx + 1) % labels.length;
      particlesRef.current.push({ fromIdx, toIdx, t: Math.random(), speed: 0.0015 + Math.random() * 0.003 });
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initNodes(window.innerWidth, window.innerHeight);
    };
    resize();
    window.addEventListener('resize', resize);

    const onMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMouse, { passive: true });

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      timeRef.current += 0.016;
      const nodes = nodesRef.current;
      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.pulse += 0.02;
        if (n.x < 50) n.vx += 0.015;
        if (n.x > w - 50) n.vx -= 0.015;
        if (n.y < 50) n.vy += 0.015;
        if (n.y > h - 50) n.vy -= 0.015;
        const dx = n.x - mouse.x;
        const dy = n.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120 && dist > 0) {
          const force = (120 - dist) * 0.0002;
          n.vx += dx * force;
          n.vy += dy * force;
        }
        n.vx *= 0.995;
        n.vy *= 0.995;
      }

      const maxDist = 260;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.12;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(45, 212, 191, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        p.t += p.speed;
        if (p.t > 1) {
          p.t = 0;
          p.fromIdx = Math.floor(Math.random() * nodes.length);
          p.toIdx = Math.floor(Math.random() * nodes.length);
          if (p.toIdx === p.fromIdx) p.toIdx = (p.toIdx + 1) % nodes.length;
        }
        const a = nodes[p.fromIdx];
        const b = nodes[p.toIdx];
        if (!a || !b) continue;
        const px = a.x + (b.x - a.x) * p.t;
        const py = a.y + (b.y - a.y) * p.t;
        const alpha = Math.sin(p.t * Math.PI) * 0.6;
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 212, 191, ${alpha})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 212, 191, ${alpha * 0.25})`;
        ctx.fill();
      }

      for (const n of nodes) {
        const ps = 1 + Math.sin(n.pulse) * 0.15;
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 20 * ps);
        grad.addColorStop(0, 'rgba(45, 212, 191, 0.1)');
        grad.addColorStop(1, 'rgba(45, 212, 191, 0)');
        ctx.beginPath();
        ctx.arc(n.x, n.y, 20 * ps, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius * ps, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(45, 212, 191, 0.5)';
        ctx.fill();
        ctx.font = '9px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y + 16);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouse);
    };
  }, [initNodes]);

  return (
    <>
      {/* Blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute w-[500px] h-[500px] -top-[10%] -left-[10%] rounded-full blur-[100px] opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.15) 0%, transparent 70%)' }} />
        <div className="absolute w-[400px] h-[400px] top-[20%] -right-[8%] rounded-full blur-[100px] opacity-40"
          style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.10) 0%, transparent 70%)' }} />
      </div>
      {/* Canvas */}
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" aria-hidden="true" />
    </>
  );
}
