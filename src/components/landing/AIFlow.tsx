'use client';

import { AIFlowDiagram } from './AIFlowDiagram';
import { InsightFeed } from './InsightFeed';

const STEPS = [
  {
    n: '01',
    title: 'Analyze',
    desc: 'Continuously monitors balances, obligations, and market conditions.',
  },
  {
    n: '02',
    title: 'Propose',
    desc: 'Generates risk-scored proposals with full reasoning.',
  },
  {
    n: '03',
    title: 'Approve',
    desc: 'Humans evaluate via role-based workflows. Multi-sig on high value.',
  },
  {
    n: '04',
    title: 'Execute',
    desc: 'Execute actions with full audit trail on every step.',
  },
];

export function AIFlow() {
  return (
    <section
      id="agent"
      className="relative py-[70px] lg:py-[102px] overflow-hidden scroll-mt-20"
      style={{
        background:
          'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(45,212,191,0.11), transparent 70%), var(--bg-void)',
        borderTop: '1px solid rgba(45,212,191,0.14)',
        borderBottom: '1px solid rgba(45,212,191,0.14)',
      }}
    >
      <div className="relative max-w-[var(--container-wide)] mx-auto px-6">
        <p
          className="text-center text-[13px] font-semibold uppercase text-[var(--teal-400)] mb-4"
          style={{ letterSpacing: '0.12em' }}
        >
          Vantor AI
        </p>
        <h2
          className="text-3xl sm:text-4xl lg:text-[40px] font-semibold text-white text-center mb-4 leading-tight"
          style={{ letterSpacing: '-0.018em' }}
        >
          Agentic intelligence, human control
        </h2>
        <p
          className="text-center text-base text-[var(--text-300)] max-w-[540px] mx-auto mb-16 leading-relaxed"
          style={{ letterSpacing: '-0.005em' }}
        >
          Vantor&apos;s AI orchestration layer monitors your treasury in real-time and queues actions for your review. You control what executes and when.
        </p>

        {/* Row 1: Diagram */}
        <div className="mb-16">
          <AIFlowDiagram />
        </div>

        {/* Row 2: Insight feed */}
        <div className="mb-24">
          <InsightFeed />
        </div>

        {/* Row 3: 4-step narrative */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
          {STEPS.map((s) => (
            <div key={s.n} className="landing-card p-6">
              <div
                className="w-9 h-9 rounded-[10px] flex items-center justify-center mb-4 text-xs font-bold text-[var(--teal-400)]"
                style={{ background: 'rgba(45,212,191,0.12)' }}
              >
                {s.n}
              </div>
              <h3
                className="text-lg font-semibold text-white mb-2"
                style={{ letterSpacing: '-0.01em' }}
              >
                {s.title}
              </h3>
              <p
                className="text-xs text-[var(--text-300)] leading-relaxed"
                style={{ letterSpacing: '-0.005em' }}
              >
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
