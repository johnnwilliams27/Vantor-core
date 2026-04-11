'use client';

import { AlertTriangle, Eye, ClipboardCheck, Users, Lock, ShieldCheck } from 'lucide-react';

const PILLARS = [
  {
    icon: AlertTriangle,
    title: 'AML & Sanctions Screening',
    desc: 'Automated anti-money laundering checks and real-time sanctions screening against OFAC, EU, and UN lists on every transaction.',
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
  {
    icon: ShieldCheck,
    title: 'Enterprise-Grade Security',
    desc: 'End-to-end encryption, hardened infrastructure, and continuous monitoring — the security posture enterprise treasury teams expect.',
  },
];

export function TrustBand() {
  return (
    <section className="relative py-24 lg:py-32 bg-[var(--bg-void)]">
      <div className="max-w-4xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl font-semibold text-white text-center mb-12 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Built for institutions
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="p-6 rounded-xl bg-white/[0.025] border border-white/[0.06] hover:border-white/[0.12] transition-colors duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-[var(--teal-400)]/10 flex items-center justify-center mb-4">
                <p.icon size={20} className="text-[var(--teal-400)]" />
              </div>
              <h3 className="text-base font-semibold text-white mb-2" style={{ letterSpacing: '-0.01em' }}>
                {p.title}
              </h3>
              <p className="text-sm text-[var(--text-300)] leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
