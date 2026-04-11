'use client';

import { AIFlowDiagram } from './AIFlowDiagram';
import { InsightFeed } from './InsightFeed';

const STEPS = [
  {
    n: '01',
    title: 'Analyze',
    desc: 'AI agents continuously monitor balances, obligations, market conditions, and yield opportunities across all connected accounts.',
  },
  {
    n: '02',
    title: 'Propose',
    desc: 'The orchestration layer generates risk-scored proposed actions with full reasoning and explainability for every queued operation.',
  },
  {
    n: '03',
    title: 'Approve',
    desc: 'Human reviewers evaluate insights through role-based approval workflows. Multi-signature support for high-value operations.',
  },
  {
    n: '04',
    title: 'Execute',
    desc: 'Approved actions are executed atomically with real-time monitoring. Every step is logged to an immutable audit trail.',
  },
];

export function AIFlow() {
  return (
    <section id="agent" className="relative py-24 lg:py-32 overflow-hidden bg-[var(--bg-void)] scroll-mt-20">
      {/* Teal bloom — single decoration */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(45,212,191,0.06) 0%, transparent 60%)',
          filter: 'blur(60px)',
        }}
        aria-hidden
      />

      <div className="relative max-w-7xl mx-auto px-6">
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-16 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Agentic intelligence, human control
        </h2>

        {/* Row 1: Diagram */}
        <div className="mb-24">
          <AIFlowDiagram />
        </div>

        {/* Row 2: Insight feed */}
        <div className="mb-24">
          <InsightFeed />
        </div>

        {/* Row 3: 4-step narrative */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="p-6 rounded-xl border border-white/[0.06] bg-white/[0.025] min-h-[160px]"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-medium text-[var(--teal-400)] tracking-wider">{s.n}</span>
                <h3 className="text-base font-semibold text-white" style={{ letterSpacing: '-0.012em' }}>
                  {s.title}
                </h3>
              </div>
              <p className="text-sm text-[var(--text-300)] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
