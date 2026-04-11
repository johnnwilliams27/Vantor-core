'use client';

import { useEffect, useRef, useCallback } from 'react';

interface Node {
  x: number; y: number; vx: number; vy: number;
  radius: number; label: string; pulse: number;
}
interface Edge {
  i: number; j: number; dist: number;
}
interface Particle {
  edgeIdx: number; t: number; speed: number; dir: 1 | -1;
}

export function NetworkCanvas({ particleCount = 50 }: { particleCount?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const timeRef = useRef(0);
  const waveOriginRef = useRef<{ x: number; y: number; t: number }[]>([]);

  const initNodes = useCallback((w: number, h: number) => {
    const labels = [
      'ERP', 'Wallet', 'Bank', 'Yield', 'FX', 'Agent',
      'USDC', 'USDT', 'Audit', 'Compliance', 'Treasury', 'DeFi',
    ];
    const cx = w / 2;
    const cy = h / 2;
    const spread = Math.min(w, h) * 0.38;
    nodesRef.current = labels.map((label, i) => {
      const angle = (i / labels.length) * Math.PI * 2 + Math.random() * 0.4;
      const dist = spread * (0.45 + Math.random() * 0.55);
      return {
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        radius: 3 + Math.random() * 2,
        label,
        pulse: Math.random() * Math.PI * 2,
      };
    });

    // Build mesh edges — connect each node to its K nearest neighbours
    const nodes = nodesRef.current;
    const edgeSet = new Set<string>();
    const edges: Edge[] = [];
    const K = 4;
    for (let i = 0; i < nodes.length; i++) {
      const dists = nodes.map((b, j) => ({
        j,
        d: Math.hypot(nodes[i].x - b.x, nodes[i].y - b.y),
      })).filter(({ j }) => j !== i).sort((a, b) => a.d - b.d);
      for (let k = 0; k < Math.min(K, dists.length); k++) {
        const key = [Math.min(i, dists[k].j), Math.max(i, dists[k].j)].join('-');
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ i, j: dists[k].j, dist: dists[k].d });
        }
      }
    }
    edgesRef.current = edges;

    // Spawn particles on edges
    particlesRef.current = [];
    for (let p = 0; p < particleCount; p++) {
      particlesRef.current.push({
        edgeIdx: Math.floor(Math.random() * edges.length),
        t: Math.random(),
        speed: 0.0015 + Math.random() * 0.0025,
        dir: Math.random() > 0.5 ? 1 : -1,
      });
    }

    // Seed initial wave origins
    waveOriginRef.current = [
      { x: cx, y: cy, t: 0 },
    ];
  }, [particleCount]);

  useEffect(() => {
    // Respect prefers-reduced-motion: skip the entire animation setup
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initNodes(rect.width, rect.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const onMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    window.addEventListener('mousemove', onMouse, { passive: true });

    const draw = () => {
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, w, h);
      timeRef.current += 0.008;
      const t = timeRef.current;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const particles = particlesRef.current;
      const mouse = mouseRef.current;
      const waves = waveOriginRef.current;

      // Spawn new wave pulses periodically from random nodes
      if (Math.random() < 0.008 && nodes.length) {
        const src = nodes[Math.floor(Math.random() * nodes.length)];
        waves.push({ x: src.x, y: src.y, t });
      }
      // Remove old waves
      while (waves.length > 0 && t - waves[0].t > 4) waves.shift();

      // Wave intensity at a point: returns 0-1
      const waveAt = (px: number, py: number): number => {
        let intensity = 0;
        for (const wave of waves) {
          const age = t - wave.t;
          const radius = age * 120;
          const d = Math.hypot(px - wave.x, py - wave.y);
          const band = 60;
          const distFromRing = Math.abs(d - radius);
          if (distFromRing < band) {
            const fade = 1 - age / 4;
            const ring = 1 - distFromRing / band;
            intensity = Math.max(intensity, ring * fade);
          }
        }
        return intensity;
      };

      // Update node positions
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.pulse += 0.02;
        if (n.x < 60) n.vx += 0.02;
        if (n.x > w - 60) n.vx -= 0.02;
        if (n.y < 60) n.vy += 0.02;
        if (n.y > h - 60) n.vy -= 0.02;
        const dx = n.x - mouse.x;
        const dy = n.y - mouse.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 120 && dist > 0) {
          const force = (120 - dist) * 0.00008;
          n.vx += dx * force;
          n.vy += dy * force;
        }
        n.vx *= 0.995;
        n.vy *= 0.995;
      }

      // Update edge distances
      for (const e of edges) {
        e.dist = Math.hypot(nodes[e.i].x - nodes[e.j].x, nodes[e.i].y - nodes[e.j].y);
      }

      // Draw mesh edges with wave-synchronised glow
      for (const e of edges) {
        const a = nodes[e.i];
        const b = nodes[e.j];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const wi = waveAt(mx, my);

        if (wi > 0.05) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(45, 212, 191, ${wi * 0.12})`;
          ctx.lineWidth = 4 + wi * 6;
          ctx.stroke();
        }

        const baseAlpha = 0.05 + wi * 0.35;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(45, 212, 191, ${baseAlpha})`;
        ctx.lineWidth = 0.6 + wi * 1.4;
        ctx.stroke();
      }

      // Draw flowing particles along edges
      for (const p of particles) {
        p.t += p.speed * p.dir;
        if (p.t > 1 || p.t < 0) {
          p.edgeIdx = Math.floor(Math.random() * edges.length);
          p.t = p.dir > 0 ? 0 : 1;
          p.dir = Math.random() > 0.5 ? 1 : -1;
        }
        const edge = edges[p.edgeIdx];
        if (!edge) continue;
        const a = nodes[edge.i];
        const b = nodes[edge.j];
        const px = a.x + (b.x - a.x) * p.t;
        const py = a.y + (b.y - a.y) * p.t;
        const wi = waveAt(px, py);
        const alpha = Math.sin(p.t * Math.PI) * (0.5 + wi * 0.5);
        const r = 1.5 + wi * 1.5;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 212, 191, ${alpha})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 212, 191, ${alpha * 0.25})`;
        ctx.fill();
      }

      // Draw nodes
      for (const n of nodes) {
        const wi = waveAt(n.x, n.y);
        const pulseScale = 1 + Math.sin(n.pulse) * 0.15 + wi * 0.3;
        const glowR = (24 + wi * 16) * pulseScale;
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR);
        grad.addColorStop(0, `rgba(45, 212, 191, ${0.1 + wi * 0.2})`);
        grad.addColorStop(1, 'rgba(45, 212, 191, 0)');
        ctx.beginPath();
        ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius * pulseScale, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 212, 191, ${0.5 + wi * 0.4})`;
        ctx.fill();
        ctx.font = '500 11px Inter, system-ui, sans-serif';
        ctx.fillStyle = `rgba(178, 193, 214, ${0.65 + wi * 0.3})`;
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y + 18);
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
    <canvas
      ref={canvasRef}
      className="absolute inset-0 -top-20 pointer-events-none opacity-90"
      aria-hidden="true"
    />
  );
}
