'use client';

import { LayoutDashboard, Coins, TrendingUp, Shield, Plug, BarChart3 } from 'lucide-react';

const CAPABILITIES = [
  {
    icon: LayoutDashboard,
    title: 'Command Center',
    bullets: ['Cash Visibility', 'AI Insights', 'Asset Management', 'AI Agent Chat'],
  },
  {
    icon: Coins,
    title: 'Treasury',
    bullets: ['AI Treasury Rules', 'Payments Operations', 'Approval Workflows', 'FX Rebalancing'],
  },
  {
    icon: TrendingUp,
    title: 'Yield',
    bullets: ['Tokenized MMFs', 'DeFi Yield Protocols', 'AI Risk Management', 'AI Yield Insights'],
  },
  {
    icon: Shield,
    title: 'Compliance',
    bullets: ['Sanctions Screening', 'Transaction Monitoring', 'Know Your Transaction', 'Travel Rule Enforcement'],
  },
  {
    icon: Plug,
    title: 'Connect',
    bullets: ['Bank Integrations', 'Wallet Integrations', 'ERP Integrations', 'Slack Connector'],
  },
  {
    icon: BarChart3,
    title: 'Data',
    bullets: ['AI Forecasting', 'Advanced Analytics', 'Audit Trail', 'Detailed Reporting'],
  },
];

export function CapabilityGrid() {
  return (
    <section
      id="platform"
      className="relative py-24 lg:py-32 bg-[var(--bg-void)] scroll-mt-20"
    >
      <div className="max-w-7xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-16 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Modern treasury management — powered by AI
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {CAPABILITIES.map((c) => (
            <div
              key={c.title}
              className="group relative p-7 rounded-xl bg-white/[0.025] border border-white/[0.06] hover:border-white/[0.12] transition-colors duration-300 min-h-[220px]"
            >
              <div className="w-11 h-11 rounded-lg bg-[var(--teal-400)]/10 flex items-center justify-center mb-5">
                <c.icon size={22} className="text-[var(--teal-400)]" />
              </div>
              <h3
                className="text-lg lg:text-xl font-semibold text-white mb-4"
                style={{ letterSpacing: '-0.012em' }}
              >
                {c.title}
              </h3>
              <ul className="space-y-2">
                {c.bullets.map((b) => (
                  <li key={b} className="text-sm lg:text-base text-[var(--text-300)] flex items-start gap-2">
                    <span className="text-[var(--teal-400)] mt-0.5">·</span>
                    <span>{b}</span>
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
