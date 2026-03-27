'use client';

import {
  FileText,
  Wallet,
  Landmark,
  TrendingUp,
  Globe,
  BarChart3,
  Brain,
  CheckCircle2,
} from 'lucide-react';

const features = [
  {
    icon: FileText,
    title: 'ERP Integration',
    desc: 'Connect QuickBooks, Xero, NetSuite, or SAP. Sync invoices and cash positions in real-time.',
  },
  {
    icon: Wallet,
    title: 'Multi-Chain Wallets',
    desc: 'Institutional-grade wallet support across Ethereum and Solana for USDC and USDT.',
  },
  {
    icon: Landmark,
    title: 'Bank Accounts',
    desc: 'Link bank accounts via Plaid. Unified fiat and crypto balance view with on/off-ramp flows.',
  },
  {
    icon: TrendingUp,
    title: 'Yield Optimization',
    desc: 'AI-driven strategies to deploy treasury reserves into vetted yield opportunities.',
  },
  {
    icon: Globe,
    title: 'FX Enablement',
    desc: 'Support for on/off ramps between multiple currencies. Automated FX to ensure you always have the right currency mix.',
  },
  {
    icon: BarChart3,
    title: 'Cash Flow Forecasting',
    desc: 'Predictive models that forecast treasury positions and generate board-ready reports.',
  },
];

const highlights = [
  'AI-generated treasury rebalancing recommendations',
  'Risk-scored yield strategies with full transparency',
  'Multi-step approval workflows before execution',
  'Immutable audit trail with decision explainability',
];

export function RegisterValueProps() {
  return (
    <div className="max-w-xl w-full space-y-6 xl:space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl xl:text-3xl font-bold text-white leading-tight">
          One Platform, Total Treasury Visibility
        </h2>
        <p className="mt-3 text-gray-400 text-sm leading-relaxed">
          Connect every financial system and asset class. Vantor unifies your ERP, digital asset wallets, and bank accounts into a single agentic hub.
        </p>
      </div>

      {/* Feature cards grid */}
      <div className="grid grid-cols-2 gap-3">
        {features.map((f) => (
          <div
            key={f.title}
            className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-teal-500/30 hover:bg-teal-500/[0.04] transition-all duration-300"
          >
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center mb-3">
              <f.icon size={16} className="text-teal-400" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">{f.title}</h3>
            <p className="text-gray-500 text-xs leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* AI highlights */}
      <div className="p-5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-center justify-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
            <Brain size={16} className="text-teal-400" />
          </div>
          <h3 className="text-sm font-bold text-white">Agentic Intelligence, Human Control</h3>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {highlights.map((h) => (
            <div key={h} className="flex items-start gap-2">
              <CheckCircle2 size={14} className="text-teal-400 shrink-0 mt-0.5" />
              <span className="text-gray-400 text-xs">{h}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
