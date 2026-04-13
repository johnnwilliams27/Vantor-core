'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Menu, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const navLinks = [
  { label: 'Platform', href: '#platform' },
  { label: 'AI Agent', href: '#agent' },
  { label: 'Contact', href: '#contact' },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const loginRef = useRef<HTMLDivElement>(null);
  const mobileSheetRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Mobile dialog: ESC to close + focus trap (first/last tabbable cycle)
  useEffect(() => {
    if (!mobileOpen) return;
    const sheet = mobileSheetRef.current;
    if (!sheet) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        hamburgerRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = sheet.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    // Move focus into the dialog on open
    const firstFocusable = sheet.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
    );
    firstFocusable?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Scroll-spy: highlight the nav link matching the visible section
  useEffect(() => {
    const sectionIds = navLinks.map((l) => l.href.replace('#', ''));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(`#${entry.target.id}`);
          }
        }
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 }
    );
    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!loginOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as globalThis.Node;
      if (loginRef.current && loginRef.current.contains(target)) return;
      setLoginOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [loginOpen]);

  // Lock body scroll when mobile sheet is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

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
      const email = fd.get('email') as string;
      try {
        const checkRes = await fetch('/api/auth/check-verified', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (!checkData.verified) {
            setLoginError('Please verify your email before signing in. Check your inbox.');
            return;
          }
        }
      } catch {
        // check-verified failed — fall through to generic error
      }
      setLoginError('Invalid email or password. Please check your credentials and try again.');
      return;
    }
    window.location.href = '/dashboard';
  };

  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-[var(--bg-void)]/80 backdrop-blur-xl border-b border-white/5 shadow-2xl'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3 group">
          <Image src="/logo-dark.png" alt="Vantor" width={140} height={44} className="object-contain" priority unoptimized />
        </Link>

        {/* Desktop links */}
        <div className="hidden lg:flex items-center gap-8">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`text-sm transition-colors duration-300 ${
                activeSection === l.href
                  ? 'text-white font-medium'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {l.label}
            </a>
          ))}
          <div className="relative" ref={loginRef}>
            <button
              onClick={() => setLoginOpen(!loginOpen)}
              aria-expanded={loginOpen}
              aria-controls="navbar-login-dropdown"
              aria-haspopup="dialog"
              className="ml-2 px-5 py-2 text-sm btn-gradient"
            >
              Login
            </button>

            {loginOpen && (
              <div
                id="navbar-login-dropdown"
                role="dialog"
                aria-label="Sign in to Vantor"
                className="absolute right-0 mt-3 w-80 rounded-2xl bg-[var(--bg-elevated)]/95 backdrop-blur-2xl border border-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden login-dropdown login-dropdown-open"
              >
                <div className="bg-gradient-to-r from-teal-600/20 to-cyan-600/20 px-6 pt-5 pb-4 border-b border-white/[0.06]">
                  <p className="text-white font-semibold text-sm">Sign in to Vantor</p>
                  <p className="text-gray-400 text-xs mt-1">Enter your credentials to continue</p>
                </div>
                <form onSubmit={handleLogin} className="px-6 py-5 space-y-4">
                  <div>
                    <label htmlFor="navbar-login-email" className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
                    <input
                      id="navbar-login-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="username"
                      inputMode="email"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-[border-color,box-shadow] duration-300"
                      placeholder="you@company.com"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="navbar-login-password" className="block text-xs font-medium text-gray-400">Password</label>
                      <Link
                        href="/forgot-password"
                        className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
                        onClick={() => setLoginOpen(false)}
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <input
                      id="navbar-login-password"
                      name="password"
                      type="password"
                      required
                      autoComplete="current-password"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-[border-color,box-shadow] duration-300"
                      placeholder="••••••••"
                    />
                  </div>
                  {loginError && (
                    <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                      {loginError}
                    </div>
                  )}
                  <Button
                    type="submit"
                    disabled={loginLoading}
                    className="w-full"
                  >
                    {loginLoading ? (
                      <><Loader2 size={14} className="animate-spin mr-2" /> Signing in...</>
                    ) : (
                      'Sign in'
                    )}
                  </Button>
                  <p className="text-center text-xs text-gray-500 mt-3">
                    Don&apos;t have an account?{' '}
                    <Link href="/register" className="text-teal-400 hover:text-teal-300 font-medium">Sign up free</Link>
                  </p>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Mobile hamburger */}
        <button
          ref={hamburgerRef}
          className="lg:hidden text-gray-300 w-12 h-12 flex items-center justify-center"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-sheet"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile full-screen sheet */}
      {mobileOpen && (
        <div
          ref={mobileSheetRef}
          id="mobile-nav-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="lg:hidden fixed inset-0 z-[100] bg-[var(--bg-void)] flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
            <Image src="/logo-dark.png" alt="Vantor" width={140} height={44} className="object-contain" priority unoptimized />
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="w-12 h-12 flex items-center justify-center text-gray-300 hover:text-white"
            >
              <X size={28} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col justify-center">
            <form onSubmit={handleLogin} className="space-y-4 max-w-sm mx-auto w-full">
              <p className="text-white font-semibold text-lg">Sign in to Vantor</p>
              <p className="text-sm text-gray-400 -mt-2">Enter your credentials to continue</p>
              <div className="space-y-1.5">
                <label htmlFor="mobile-login-email" className="block text-xs font-medium text-gray-400">Email</label>
                <input
                  id="mobile-login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  inputMode="email"
                  className="w-full px-3.5 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-[border-color,box-shadow] duration-300"
                  placeholder="you@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="mobile-login-password" className="block text-xs font-medium text-gray-400">Password</label>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
                    onClick={() => setMobileOpen(false)}
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  id="mobile-login-password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="w-full px-3.5 py-3 min-h-[48px] rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-base placeholder-gray-500 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/25 transition-[border-color,box-shadow] duration-300"
                  placeholder="••••••••"
                />
              </div>
              {loginError && (
                <div role="alert" className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                  {loginError}
                </div>
              )}
              <Button
                type="submit"
                disabled={loginLoading}
                className="w-full min-h-[48px]"
                size="lg"
              >
                {loginLoading ? (
                  <><Loader2 size={14} className="animate-spin mr-2" /> Signing in...</>
                ) : (
                  'Sign in'
                )}
              </Button>
              <p className="text-center text-xs text-gray-500 mt-3">
                Don&apos;t have an account?{' '}
                <Link href="/register" onClick={() => setMobileOpen(false)} className="text-teal-400 hover:text-teal-300 font-medium">Sign up free</Link>
              </p>
            </form>
          </div>
        </div>
      )}
    </nav>
  );
}
