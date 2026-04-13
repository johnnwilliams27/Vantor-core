'use client';

import {
  LayoutDashboard,
  Coins,
  TrendingUp,
  Shield,
  Plug,
  BarChart3,
} from 'lucide-react';

const capabilities = [
  {
    icon: LayoutDashboard,
    title: 'Dashboard',
    desc: 'Unified view across every bank account, stablecoin wallet, and yield protocol.',
  },
  {
    icon: Coins,
    title: 'Treasury',
    desc: 'AI-drafted moves with full reasoning, queued for your approval.',
  },
  {
    icon: TrendingUp,
    title: 'Yield',
    desc: 'Tokenized MMFs and DeFi protocols on a single rate board.',
  },
  {
    icon: Shield,
    title: 'Compliance',
    desc: 'Sanctions, monitoring, and travel rule — built in, not bolted on.',
  },
  {
    icon: Plug,
    title: 'Connect',
    desc: 'Banks, wallets, ERPs, and team tools in one integration layer.',
  },
  {
    icon: BarChart3,
    title: 'Data',
    desc: 'Forecasting, analytics, and audit trails that tell the full story.',
  },
];

const insights = [
  '$2.3M idle USDC → Spiko USD · +4.9% APY',
  '€1.8M payroll due → Convert USD to EUR',
  '$2.8M quarterly tax → Schedule USD payment',
];

export function RegisterValueProps() {
  return (
    <div className="max-w-xl w-full space-y-8">
      {/* Header */}
      <div>
        <p
          className="text-[13px] font-semibold uppercase text-[var(--teal-400)] mb-3"
          style={{ letterSpacing: '0.12em' }}
        >
          The Platform
        </p>
        <h2
          className="text-2xl xl:text-3xl font-bold text-white leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Agentic intelligence, human control
        </h2>
        <p className="mt-3 text-[var(--text-300)] text-sm leading-relaxed">
          Everything your treasury team needs — from real-time cash visibility to automated yield insights, compliance, and reporting.
        </p>
      </div>

      {/* Capability cards grid */}
      <div className="grid grid-cols-2 gap-3">
        {capabilities.map((c) => (
          <div
            key={c.title}
            className="landing-card p-4"
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
              style={{ background: 'rgba(45,212,191,0.12)' }}
            >
              <c.icon size={16} className="text-[var(--teal-400)]" strokeWidth={1.75} />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">{c.title}</h3>
            <p className="text-[var(--text-300)] text-xs leading-relaxed">{c.desc}</p>
          </div>
        ))}
      </div>

      {/* Live insight examples */}
      <div className="landing-card p-5">
        <p
          className="text-xs font-semibold uppercase text-[var(--teal-400)] mb-3"
          style={{ letterSpacing: '0.08em' }}
        >
          Live AI Recommendations
        </p>
        <div className="space-y-2">
          {insights.map((text) => (
            <div
              key={text}
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(45,212,191,0.2)',
              }}
            >
              <span className="text-xs text-[var(--text-100)] flex-1">{text}</span>
              <span
                className="shrink-0 text-3xs font-semibold rounded-full px-2.5 py-0.5 select-none"
                style={{
                  background: 'rgba(45,212,191,0.2)',
                  border: '1px solid rgba(45,212,191,0.4)',
                  color: 'var(--teal-400)',
                }}
              >
                Approve?
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
