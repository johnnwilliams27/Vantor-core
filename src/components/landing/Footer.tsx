'use client';

import Image from 'next/image';
import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-12" style={{ background: 'var(--bg-deep-navy)' }}>
      <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <Image src="/logo-dark.png" alt="Vantor" width={100} height={32} className="object-contain opacity-60" unoptimized />
        </div>
        <p className="text-[var(--text-300)] text-sm">&copy; {new Date().getFullYear()} Vantor Treasury, Inc. All rights reserved.</p>
        <div className="flex items-center gap-6 flex-wrap justify-center">
          <a href="#platform" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">Platform</a>
          <a href="#agent" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">AI Agent</a>
          <a href="#contact" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">Contact</a>
          <Link href="/terms" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">Terms</Link>
          <Link href="/privacy" className="text-[var(--text-300)] hover:text-[var(--text-100)] text-sm transition-colors">Privacy</Link>
          <a
            href="https://www.linkedin.com/company/vantortreasury"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--text-300)] hover:text-[var(--text-100)] transition-colors"
            aria-label="LinkedIn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          </a>
          <a
            href="https://www.x.com/VantorTreasury"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--text-300)] hover:text-[var(--text-100)] transition-colors"
            aria-label="X"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
