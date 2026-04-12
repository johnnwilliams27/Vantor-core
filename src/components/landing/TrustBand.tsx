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
    <section
      id="security"
      className="relative py-[70px] lg:py-[102px] bg-[var(--bg-void)] overflow-hidden"
    >
      {/* Soft teal bloom at top */}
      <div
        className="absolute pointer-events-none left-1/2 -translate-x-1/2"
        style={{
          width: '480px',
          height: '300px',
          top: '-80px',
          background: 'radial-gradient(circle, rgba(45,212,191,0.12), transparent 70%)',
          filter: 'blur(80px)',
          opacity: 0.4,
        }}
        aria-hidden
      />

      <div className="relative max-w-[var(--container-narrow)] mx-auto px-6">
        <p
          className="text-center text-[13px] font-semibold uppercase text-[var(--teal-400)] mb-4"
          style={{ letterSpacing: '0.12em' }}
        >
          Security &amp; Compliance
        </p>
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-4 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Institutional-grade from day one
        </h2>
        <p
          className="text-center text-base text-[var(--text-300)] max-w-[540px] mx-auto mb-16 leading-relaxed"
          style={{ letterSpacing: '-0.005em' }}
        >
          Every layer — from wallet onboarding to AI-proposed actions — is designed with compliance, auditability, and security at its core.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {PILLARS.map((p) => (
            <div key={p.title} className="landing-card px-5 py-[22px]">
              <div
                className="w-8 h-8 rounded-[9px] flex items-center justify-center mb-3.5"
                style={{ background: 'rgba(45,212,191,0.12)' }}
              >
                <p.icon size={16} className="text-[var(--teal-400)]" strokeWidth={1.75} />
              </div>
              <h3
                className="text-base font-semibold text-white mb-1.5"
                style={{ letterSpacing: '-0.01em' }}
              >
                {p.title}
              </h3>
              <p
                className="text-xs text-[var(--text-300)] leading-relaxed"
                style={{ letterSpacing: '-0.005em' }}
              >
                {p.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
