'use client';

import { LayoutDashboard, Coins, TrendingUp, Shield, Plug, BarChart3, Check } from 'lucide-react';

const CAPABILITIES = [
  {
    icon: LayoutDashboard,
    title: 'Dashboard',
    desc: 'Unified view across every bank account, stablecoin wallet, and yield protocol.',
    bullets: ['Cash Visibility', 'AI Insights', 'Asset Management', 'AI Agent Chat'],
    badge: 'Real-time',
  },
  {
    icon: Coins,
    title: 'Treasury',
    desc: 'AI-drafted moves with full reasoning, queued for your approval.',
    bullets: ['AI Treasury Rules', 'Payments Operations', 'Approval Workflows', 'FX Rebalancing'],
    badge: 'Human-in-the-loop',
  },
  {
    icon: TrendingUp,
    title: 'Yield',
    desc: 'Tokenized MMFs and DeFi protocols on a single rate board.',
    bullets: ['Tokenized MMFs', 'DeFi Yield Protocols', 'AI Risk Management', 'AI Yield Insights'],
    badge: '4.9% avg APY',
  },
  {
    icon: Shield,
    title: 'Compliance',
    desc: 'Sanctions, monitoring, and travel rule — built in, not bolted on.',
    bullets: ['Sanctions Screening', 'Transaction Monitoring', 'Know Your Transaction', 'Travel Rule Enforcement'],
    badge: 'OFAC · EU · UN',
  },
  {
    icon: Plug,
    title: 'Connect',
    desc: 'Banks, wallets, ERPs, and team tools in one integration layer.',
    bullets: ['Bank Integrations', 'Wallet Integrations', 'ERP Integrations', 'Slack Connector'],
    badge: '6 integrations',
  },
  {
    icon: BarChart3,
    title: 'Data',
    desc: 'Forecasting, analytics, and audit trails that tell the full story.',
    bullets: ['AI Forecasting', 'Advanced Analytics', 'Audit Trail', 'Detailed Reporting'],
    badge: 'AI-powered',
  },
];

export function CapabilityGrid() {
  return (
    <section
      id="platform"
      className="relative py-[70px] lg:py-[102px] bg-[var(--bg-void)] scroll-mt-20"
    >
      <div className="max-w-[var(--container-wide)] mx-auto px-6">
        <p
          className="text-center text-[13px] font-semibold uppercase text-[var(--teal-400)] mb-4"
          style={{ letterSpacing: '0.12em' }}
        >
          Platform
        </p>
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-4 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Modern treasury management — powered by AI
        </h2>
        <p
          className="text-center text-base text-[var(--text-300)] max-w-[540px] mx-auto mb-16 leading-relaxed"
          style={{ letterSpacing: '-0.005em' }}
        >
          Everything your treasury team needs — from real-time cash visibility to automated yield insights, compliance, and reporting.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="landing-card px-6 py-6 flex flex-col">
              <div
                className="w-10 h-10 rounded-[11px] flex items-center justify-center mb-4"
                style={{ background: 'rgba(45,212,191,0.12)' }}
              >
                <c.icon size={20} className="text-[var(--teal-400)]" strokeWidth={1.75} />
              </div>
              <h3
                className="text-lg font-semibold text-white mb-1.5"
                style={{ letterSpacing: '-0.01em' }}
              >
                {c.title}
              </h3>
              <p
                className="text-[13px] text-[var(--text-300)] mb-4 leading-relaxed"
                style={{ letterSpacing: '-0.005em' }}
              >
                {c.desc}
              </p>
              <ul className="space-y-1.5">
                {c.bullets.map((b) => (
                  <li
                    key={b}
                    className="text-[13px] text-[var(--text-200)] flex items-center gap-2"
                    style={{ letterSpacing: '-0.005em' }}
                  >
                    <Check className="h-3.5 w-3.5 text-[var(--teal-400)] shrink-0" aria-hidden="true" strokeWidth={2.5} />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
