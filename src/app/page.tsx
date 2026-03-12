'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Shield,
  Brain,
  Landmark,
  Wallet,
  FileText,
  ArrowRight,
  CheckCircle2,
  Lock,
  Eye,
  Users,
  Bot,
  TrendingUp,
  Globe,
  AlertTriangle,
  ClipboardCheck,
  Send,
  Menu,
  X,
  ChevronDown,
  Layers,
  BarChart3,
  Loader2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Intersection-observer hook for scroll-triggered animations        */
/* ------------------------------------------------------------------ */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.unobserve(el); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

/* ------------------------------------------------------------------ */
/*  Network canvas — nodes, connections, flowing particles            */
/* ------------------------------------------------------------------ */
interface Node {
  x: number; y: number; vx: number; vy: number;
  radius: number; label: string; icon: string; pulse: number;
}
interface Particle {
  fromIdx: number; toIdx: number; t: number; speed: number;
}

function NetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Node[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const timeRef = useRef(0);

  const initNodes = useCallback((w: number, h: number) => {
    const labels = [
      { label: 'ERP', icon: '\u{1F4CA}' },
      { label: 'Wallet', icon: '\u{1F4B0}' },
      { label: 'Bank', icon: '\u{1F3E6}' },
      { label: 'Yield', icon: '\u{1F4C8}' },
      { label: 'FX', icon: '\u{1F30D}' },
      { label: 'Agent', icon: '\u{1F916}' },
      { label: 'USDC', icon: '\u{1F4B5}' },
      { label: 'USDT', icon: '\u{1F4B2}' },
      { label: 'Audit', icon: '\u{1F50D}' },
      { label: 'Compliance', icon: '\u{1F6E1}' },
      { label: 'Treasury', icon: '\u{1F3DB}' },
      { label: 'DeFi', icon: '\u{26D3}' },
    ];
    const cx = w / 2;
    const cy = h / 2;
    const spread = Math.min(w, h) * 0.38;
    nodesRef.current = labels.map((l, i) => {
      const angle = (i / labels.length) * Math.PI * 2 + Math.random() * 0.4;
      const dist = spread * (0.5 + Math.random() * 0.5);
      return {
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: 3 + Math.random() * 2,
        label: l.label,
        icon: l.icon,
        pulse: Math.random() * Math.PI * 2,
      };
    });
    // Spawn particles along edges
    particlesRef.current = [];
    for (let i = 0; i < 40; i++) {
      const fromIdx = Math.floor(Math.random() * labels.length);
      let toIdx = Math.floor(Math.random() * labels.length);
      if (toIdx === fromIdx) toIdx = (toIdx + 1) % labels.length;
      particlesRef.current.push({
        fromIdx, toIdx,
        t: Math.random(),
        speed: 0.002 + Math.random() * 0.004,
      });
    }
  }, []);

  useEffect(() => {
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
      timeRef.current += 0.016;
      const t = timeRef.current;
      const nodes = nodesRef.current;
      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      // Update node positions (gentle drift)
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.pulse += 0.02;
        // Soft boundary
        if (n.x < 60) n.vx += 0.02;
        if (n.x > w - 60) n.vx -= 0.02;
        if (n.y < 60) n.vy += 0.02;
        if (n.y > h - 60) n.vy -= 0.02;
        // Mouse repulsion
        const dx = n.x - mouse.x;
        const dy = n.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150 && dist > 0) {
          const force = (150 - dist) * 0.0003;
          n.vx += dx * force;
          n.vy += dy * force;
        }
        // Damping
        n.vx *= 0.995;
        n.vy *= 0.995;
      }

      // Draw connections
      const maxDist = 280;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.15;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(45, 212, 191, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Draw flowing particles
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
        const alpha = Math.sin(p.t * Math.PI) * 0.7;
        ctx.beginPath();
        ctx.arc(px, py, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 212, 191, ${alpha})`;
        ctx.fill();
        // Glow
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(45, 212, 191, ${alpha * 0.3})`;
        ctx.fill();
      }

      // Draw nodes
      for (const n of nodes) {
        const pulseScale = 1 + Math.sin(n.pulse) * 0.15;
        // Outer glow
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 24 * pulseScale);
        grad.addColorStop(0, 'rgba(45, 212, 191, 0.12)');
        grad.addColorStop(1, 'rgba(45, 212, 191, 0)');
        ctx.beginPath();
        ctx.arc(n.x, n.y, 24 * pulseScale, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        // Core dot
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius * pulseScale, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(45, 212, 191, 0.6)';
        ctx.fill();
        // Label
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
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
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Animated blob background                                          */
/* ------------------------------------------------------------------ */
function BlobBackground() {
  return (
    <div className="blob-wrap" aria-hidden>
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Navbar                                                            */
/* ------------------------------------------------------------------ */
function Navbar() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const loginRef = useRef<HTMLDivElement>(null);
  const mobileLoginRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!loginOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as globalThis.Node;
      if (loginRef.current && loginRef.current.contains(target)) return;
      if (mobileLoginRef.current && mobileLoginRef.current.contains(target)) return;
      setLoginOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [loginOpen]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    const fd = new FormData(e.currentTarget);
    const result = await signIn('credentials', {
      email: fd.get('email') as string,
      password: fd.get('password') as string,
      redirect: false,
    });
    setLoginLoading(false);
    if (result?.error) {
      setLoginError('Invalid email or password');
      return;
    }
    router.push('/dashboard');
    router.refresh();
  };

  const navLinks = [
    { label: 'Features', href: '#features' },
    { label: 'Security', href: '#security' },
    { label: 'AI Agent', href: '#agent' },
    { label: 'Contact', href: '#contact' },
  ];

  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-[#060d1f]/80 backdrop-blur-xl border-b border-white/5 shadow-2xl'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3 group">
          <Image src="/logo-dark.png" alt="Vantor" width={140} height={44} className="object-contain" priority unoptimized />
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-gray-400 hover:text-white transition-colors duration-300"
            >
              {l.label}
            </a>
          ))}
          <div className="relative" ref={loginRef}>
            <button
              onClick={() => setLoginOpen(!loginOpen)}
              className="ml-2 px-5 py-2 rounded-full text-sm font-medium bg-gradient-to-r from-teal-500 to-cyan-400 text-white hover:shadow-[0_0_24px_rgba(45,212,191,0.35)] transition-all duration-300"
            >
              Login
            </button>

            {/* Login dropdown */}
            <div
              className={`absolute right-0 mt-3 w-80 rounded-2xl bg-[#0a1628]/95 backdrop-blur-2xl border border-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden login-dropdown ${
                loginOpen ? 'login-dropdown-open' : 'login-dropdown-closed'
              }`}
            >
              <div className="bg-gradient-to-r from-teal-600/20 to-cyan-600/20 px-6 pt-5 pb-4 border-b border-white/[0.06]">
                <p className="text-white font-semibold text-sm">Sign in to Vantor</p>
                <p className="text-gray-400 text-xs mt-1">Enter your credentials to continue</p>
              </div>
              <form onSubmit={handleLogin} className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
                  <input
                    name="email"
                    type="email"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-all duration-300"
                    placeholder="you@company.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
                  <input
                    name="password"
                    type="password"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-all duration-300"
                    placeholder="••••••••"
                  />
                </div>
                {loginError && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                    {loginError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-teal-500 to-cyan-400 text-white hover:shadow-[0_0_24px_rgba(45,212,191,0.3)] transition-all duration-300 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loginLoading ? (
                    <><Loader2 size={14} className="animate-spin" /> Signing in...</>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden text-gray-400" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[#060d1f]/95 backdrop-blur-xl border-t border-white/5 px-6 pb-6 pt-2 space-y-4 animate-dropdown">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="block text-gray-300 hover:text-white transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {l.label}
            </a>
          ))}
          {!loginOpen ? (
            <button
              onClick={() => setLoginOpen(true)}
              className="block w-full text-center px-5 py-2.5 rounded-full text-sm font-medium bg-gradient-to-r from-teal-500 to-cyan-400 text-white"
            >
              Login
            </button>
          ) : (
            <form ref={mobileLoginRef} onSubmit={handleLogin} className="space-y-3 pt-2 border-t border-white/[0.06]">
              <p className="text-white font-semibold text-sm">Sign in to Vantor</p>
              <input
                name="email"
                type="email"
                required
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-all duration-300"
                placeholder="you@company.com"
              />
              <input
                name="password"
                type="password"
                required
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-all duration-300"
                placeholder="••••••••"
              />
              {loginError && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                  {loginError}
                </div>
              )}
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-teal-500 to-cyan-400 text-white hover:shadow-[0_0_24px_rgba(45,212,191,0.3)] transition-all duration-300 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loginLoading ? (
                  <><Loader2 size={14} className="animate-spin" /> Signing in...</>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>
          )}
        </div>
      )}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Partner Scroll                                                     */
/* ------------------------------------------------------------------ */
const PARTNERS = [
  { name: 'SAP', src: '/partners/SAP_idL9dEduKh_0.svg', className: 'h-11' },
  { name: 'NetSuite', src: '/partners/NetSuite_idAICRYoQY_0.svg', className: 'h-11' },
  { name: 'Xero', src: '/partners/xero-cutout.svg', className: 'h-12' },
  { name: 'MetaMask', src: '/partners/MetaMask_Logo_0.svg', className: 'h-11' },
  { name: 'Phantom', src: '/partners/Phantom_Logo_0.svg', className: 'h-11' },
  { name: 'WalletConnect', src: '/partners/walletconnect-white.svg', className: 'h-8' },
  { name: 'Plaid', src: '/partners/Plaid_id25TiQUJW_0.svg', className: 'h-11' },
];

function PartnerScroll() {
  return (
    <section className="relative py-14 border-y border-white/[0.06] shrink-0">
      <div className="max-w-5xl mx-auto text-center px-6">
        <div className="relative overflow-hidden max-w-4xl mx-auto" style={{ maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)' }}>
          <div className="partner-scroll-track">
            {[...PARTNERS, ...PARTNERS].map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                className="flex items-center justify-center px-8 shrink-0"
              >
                <Image
                  src={p.src}
                  alt={p.name}
                  width={160}
                  height={56}
                  className={`${p.className} w-auto object-contain opacity-70`}
                  unoptimized
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero                                                              */
/* ------------------------------------------------------------------ */
function Hero() {
  return (
    <section className="relative flex-1 flex items-center justify-center overflow-hidden">
      <BlobBackground />
      <NetworkCanvas />

      <div className="relative z-10 max-w-5xl mx-auto text-center px-6">
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] landing-fade-in landing-delay-1">
          <span className="text-white">Put Your Idle Treasury</span>
          <br />
          <span className="bg-gradient-to-r from-teal-400 via-cyan-300 to-teal-400 bg-clip-text text-transparent">
            Reserves to Work
          </span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed landing-fade-in landing-delay-2">
          Connect your ERP system, digital asset wallets, and bank accounts for agentic treasury management. Let Vantor's agents optimize yield, hedge FX exposure, and manage compliance — always with a human in the loop.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 landing-fade-in landing-delay-3">
          <a
            href="#contact"
            className="group px-8 py-3.5 rounded-full text-base font-semibold bg-gradient-to-r from-teal-500 to-cyan-400 text-white hover:shadow-[0_0_32px_rgba(45,212,191,0.4)] transition-all duration-500"
          >
            Get in Touch
            <ArrowRight size={16} className="inline ml-2 group-hover:translate-x-1 transition-transform" />
          </a>
          <a
            href="#features"
            className="px-8 py-3.5 rounded-full text-base font-medium text-gray-300 border border-white/10 hover:border-white/25 hover:bg-white/5 transition-all duration-300"
          >
            Explore Platform
          </a>
        </div>

        {/* Floating metric pills */}
        <div className="mt-16 flex flex-col items-center gap-4 landing-fade-in landing-delay-4">
          <div className="flex flex-wrap items-center justify-center gap-6">
            {[
              { label: 'Multi-Chain Stablecoin Support', icon: Globe },
              { label: 'Institutional Grade Infrastructure', icon: Shield },
              { label: 'Human-in-the-Loop', icon: Users },
            ].map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.06] text-sm text-gray-400"
              >
                <Icon size={15} className="text-teal-400" />
                {label}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6">
            {[
              { label: 'Agentic Recommendation Engine', icon: Brain },
              { label: 'Compliance-First Architecture', icon: Lock },
            ].map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.06] text-sm text-gray-400"
              >
                <Icon size={15} className="text-teal-400" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 landing-fade-in landing-delay-4">
        <ChevronDown size={24} className="text-gray-600 animate-bounce" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */
function Section({
  id,
  children,
  className = '',
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`relative py-10 sm:py-14 scroll-mt-20 ${className}`}>
      <div className="max-w-7xl mx-auto px-6">{children}</div>
    </section>
  );
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  const { ref, visible } = useInView();
  return (
    <div ref={ref} className={`max-w-3xl mx-auto text-center mb-10 ${visible ? 'landing-fade-in' : 'opacity-0'}`}>
      <span className="text-teal-400 text-sm font-semibold tracking-widest uppercase">{eyebrow}</span>
      <h2 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight">{title}</h2>
      <p className="mt-4 text-gray-400 text-lg leading-relaxed">{subtitle}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Features — Connect Everything                                      */
/* ------------------------------------------------------------------ */
function Features() {
  const features = [
    {
      icon: FileText,
      title: 'ERP Integration',
      desc: 'Connect QuickBooks, Xero, NetSuite, or SAP. Sync invoices, obligations, and cash positions in real-time so your treasury decisions are always grounded in live data.',
    },
    {
      icon: Wallet,
      title: 'Multi-Chain Wallets',
      desc: 'Institutional-grade wallet onboarding across Ethereum and Solana. Support for USDC, USDT, and PYUSD with real-time balance monitoring and transaction tracking.',
    },
    {
      icon: Landmark,
      title: 'Bank Accounts',
      desc: 'Link your bank accounts via Plaid or Bridge. Unified fiat and crypto balance view, on-ramp/off-ramp flows, and automated cash position reconciliation.',
    },
    {
      icon: TrendingUp,
      title: 'Yield Optimization',
      desc: 'AI-driven strategies to deploy treasury reserves into vetted yield opportunities. Risk-scored recommendations with full transparency on APY and exposure.',
    },
    {
      icon: Globe,
      title: 'FX Hedging',
      desc: 'Complex cross-currency hedging strategies for multi-currency treasuries. Automated monitoring of FX exposure with intelligent rebalancing recommendations.',
    },
    {
      icon: BarChart3,
      title: 'Cash Flow Forecasting',
      desc: 'Predictive models that forecast treasury positions. Simulate scenarios, stress-test reserves, and generate board-ready reports with a single click.',
    },
  ];

  return (
    <Section id="features">
      <SectionHeading
        eyebrow="Platform"
        title="One Platform, Total Treasury Visibility"
        subtitle="Connect every financial system and asset class. Vantor unifies your ERP, digital asset wallets, and bank accounts into a single command center for modern treasury management."
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((f, i) => {
          const { ref, visible } = useInView(0.1);
          return (
            <div
              key={f.title}
              ref={ref}
              className={`group relative p-7 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-teal-500/30 hover:bg-teal-500/[0.04] transition-all duration-500 ${
                visible ? 'landing-fade-in' : 'opacity-0'
              }`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="w-11 h-11 rounded-xl bg-teal-500/10 flex items-center justify-center mb-5 group-hover:bg-teal-500/20 transition-colors duration-300">
                <f.icon size={22} className="text-teal-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Agentic AI — Human in the Loop                                     */
/* ------------------------------------------------------------------ */
function AgentSection() {
  const { ref, visible } = useInView();

  const capabilities = [
    'AI-generated treasury rebalancing recommendations',
    'Yield farming strategy proposals with risk scoring',
    'FX hedging alerts and automated position monitoring',
    'Cash flow anomaly detection and obligation tracking',
    'Multi-step approval workflows before execution',
    'Full audit trail with AI decision explainability',
    'Customizable treasury rules engine',
    'Natural language treasury queries and reporting',
  ];

  return (
    <Section id="agent" className="overflow-hidden">
      <div className="relative">
        {/* Accent glow */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-teal-500/[0.06] rounded-full blur-[120px] pointer-events-none" />

        <SectionHeading
          eyebrow="AI Agent"
          title="Agentic Intelligence, Human Control"
          subtitle="Vantor's AI orchestration layer analyzes your treasury in real-time and surfaces actionable recommendations — but you always make the final call."
        />

        <div
          ref={ref}
          className={`grid lg:grid-cols-2 gap-12 items-center ${visible ? 'landing-fade-in' : 'opacity-0'}`}
        >
          {/* Left: Agent flow visualization */}
          <div className="relative">
            <div className="space-y-4">
              {[
                { step: '01', title: 'Analyze', desc: 'AI agents continuously monitor balances, obligations, market conditions, and yield opportunities across all connected accounts.' },
                { step: '02', title: 'Recommend', desc: 'The orchestration layer generates risk-scored recommendations with full reasoning and explainability for every suggested action.' },
                { step: '03', title: 'Approve', desc: 'Human reviewers evaluate recommendations through role-based approval workflows. Multi-signature support for high-value operations.' },
                { step: '04', title: 'Execute', desc: 'Approved actions are executed atomically with real-time monitoring. Every step is logged to an immutable audit trail.' },
              ].map((s, i) => (
                <div
                  key={s.step}
                  className="flex gap-5 p-5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-teal-500/20 transition-all duration-500"
                  style={{ animationDelay: `${i * 120}ms` }}
                >
                  <div className="shrink-0 w-10 h-10 rounded-lg bg-teal-500/10 flex items-center justify-center text-teal-400 text-sm font-bold">
                    {s.step}
                  </div>
                  <div>
                    <h4 className="font-semibold text-white mb-1">{s.title}</h4>
                    <p className="text-sm text-gray-400 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Capabilities list */}
          <div>
            <div className="p-8 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center">
                  <Brain size={22} className="text-teal-400" />
                </div>
                <h3 className="text-xl font-bold text-white">Built-in AI Workflows</h3>
              </div>
              <div className="space-y-3">
                {capabilities.map((c) => (
                  <div key={c} className="flex items-start gap-3">
                    <CheckCircle2 size={18} className="text-teal-400 shrink-0 mt-0.5" />
                    <span className="text-gray-300 text-sm">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Security & Compliance                                              */
/* ------------------------------------------------------------------ */
function Security() {
  const pillars = [
    {
      icon: AlertTriangle,
      title: 'AML & Sanctions Screening',
      desc: 'Automated anti-money laundering checks and real-time sanctions screening against OFAC, EU, and UN lists on every transaction.',
    },
    {
      icon: Globe,
      title: 'Travel Rule Compliance',
      desc: 'Built-in Travel Rule compliance for cross-border digital asset transfers. Automatic originator and beneficiary data collection and transmission.',
    },
    {
      icon: Eye,
      title: 'Transaction Monitoring',
      desc: 'Continuous monitoring of all on-chain and off-chain transactions. Pattern detection, velocity checks, and anomalous behavior alerting.',
    },
    {
      icon: ClipboardCheck,
      title: 'Audit Logging & Explainability',
      desc: 'Immutable audit trail for every action — human and AI. Full decision provenance so you can explain exactly why any action was taken.',
    },
    {
      icon: Users,
      title: 'Role-Based Permissions',
      desc: 'Granular RBAC with treasury manager, analyst, viewer, and admin roles. Enforce least-privilege access across your entire organization.',
    },
    {
      icon: Lock,
      title: 'Approval Workflows',
      desc: 'Configurable multi-level approval chains. High-value transactions require multiple authorized signers before execution.',
    },
  ];

  return (
    <Section id="security">
      <SectionHeading
        eyebrow="Security & Compliance"
        title="Institutional-Grade from Day One"
        subtitle="Vantor is built for secure treasury management. Every layer — from wallet onboarding to AI recommendations — is designed with compliance, auditability, and security at its core."
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {pillars.map((p, i) => {
          const { ref, visible } = useInView(0.1);
          return (
            <div
              key={p.title}
              ref={ref}
              className={`group relative p-7 rounded-2xl border transition-all duration-500 ${
                visible ? 'landing-fade-in' : 'opacity-0'
              }`}
              style={{
                animationDelay: `${i * 80}ms`,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(45,212,191,0.03) 100%)',
                borderColor: 'rgba(255,255,255,0.06)',
              }}
            >
              <div className="w-11 h-11 rounded-xl bg-teal-500/10 flex items-center justify-center mb-5 group-hover:bg-teal-500/20 transition-colors duration-300">
                <p.icon size={22} className="text-teal-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{p.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{p.desc}</p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Contact Form                                                       */
/* ------------------------------------------------------------------ */
function ContactForm() {
  const { ref, visible } = useInView();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('sending');
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fd.get('name'),
          email: fd.get('email'),
          company: fd.get('company'),
          message: fd.get('message'),
        }),
      });
      if (!res.ok) throw new Error();
      setStatus('sent');
      formRef.current?.reset();
    } catch {
      setStatus('error');
    }
  };

  return (
    <Section id="contact">
      <div className="relative">
        <div className="absolute -top-40 right-0 w-[500px] h-[500px] bg-teal-500/[0.05] rounded-full blur-[100px] pointer-events-none" />
        <SectionHeading
          eyebrow="Contact"
          title="Ready to Optimize Your Treasury?"
          subtitle="Get in touch to learn how Vantor can transform your treasury operations."
        />

        <div
          ref={ref}
          className={`max-w-2xl mx-auto ${visible ? 'landing-fade-in' : 'opacity-0'}`}
        >
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="p-8 sm:p-10 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-6"
          >
            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Name</label>
                <input
                  name="name"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-all duration-300 text-sm"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
                <input
                  name="email"
                  type="email"
                  required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-all duration-300 text-sm"
                  placeholder="you@company.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Company</label>
              <input
                name="company"
                className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-all duration-300 text-sm"
                placeholder="Company name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Message</label>
              <textarea
                name="message"
                required
                rows={4}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-all duration-300 text-sm resize-none"
                placeholder="Tell us about your treasury needs..."
              />
            </div>
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full sm:w-auto px-8 py-3.5 rounded-full text-sm font-semibold bg-gradient-to-r from-teal-500 to-cyan-400 text-white hover:shadow-[0_0_32px_rgba(45,212,191,0.4)] transition-all duration-500 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {status === 'sending' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send size={16} />
                  Send Message
                </>
              )}
            </button>
            {status === 'sent' && (
              <p className="text-teal-400 text-sm flex items-center gap-2">
                <CheckCircle2 size={16} /> Message sent. We&apos;ll be in touch shortly.
              </p>
            )}
            {status === 'error' && (
              <p className="text-red-400 text-sm">Something went wrong. Please email john@vantor.xyz directly.</p>
            )}
          </form>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Footer                                                             */
/* ------------------------------------------------------------------ */
function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-12">
      <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <Image src="/logo-dark.png" alt="Vantor" width={100} height={32} className="object-contain opacity-60" unoptimized />
        </div>
        <p className="text-gray-500 text-sm">&copy; {new Date().getFullYear()} Vantor Treasury, Inc. All rights reserved.</p>
        <div className="flex items-center gap-6">
          <a href="#features" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">Features</a>
          <a href="#security" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">Security</a>
          <a href="#contact" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">Contact</a>
          <Link href="/terms" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">Terms</Link>
          <Link href="/privacy" className="text-gray-500 hover:text-gray-300 text-sm transition-colors">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#060d1f] text-white overflow-x-hidden landing-page">
      <Navbar />
      <div className="flex flex-col min-h-screen">
        {/* Spacer for fixed navbar (h-16 = 64px) */}
        <div className="h-16 shrink-0" />
        <Hero />
        <PartnerScroll />
      </div>
      <Features />
      <AgentSection />
      <Security />
      <ContactForm />
      <Footer />
    </div>
  );
}
