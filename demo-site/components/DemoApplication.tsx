'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight, ArrowRight, ArrowUpRight,
  BarChart3, Bell, BrainCircuit, Check, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, Clock3, Download, Globe2, LockKeyhole, Menu,
  Plus, RefreshCw, Search, Send, ShieldCheck, Sparkles,
  TrendingUp, Wallet, X,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  ASSET_MIX, CASH_FLOW, DEMO_GROUPS, DEMO_SURFACES, LIQUIDITY_POINTS,
  type DemoRow,
} from './demoData';

const money = (n: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(n);
const panel = 'rounded-2xl border border-[#dce7f5] bg-[#ffffff] shadow-[0_8px_30px_rgba(15,56,121,.06)]';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/60';
const storageKey = 'latitude-concept-demo-2026';

type DemoPersisted = { added: Record<string, DemoRow[]>; statuses: Record<string, string> };
const initialState: DemoPersisted = { added: {}, statuses: {} };

function StatusPill({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const tone = /completed|connected|verified|healthy|active|confirmed|approved|earning|covered|ready|clear|allowed|paid|recorded|updated|available/.test(lower)
    ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
    : /denied|failed|overdue|blocked/.test(lower)
      ? 'bg-rose-400/10 text-rose-300 border-rose-400/20'
      : /pending|processing|scheduled|unread|review|attention|recommended|quoted/.test(lower)
        ? 'bg-amber-400/10 text-amber-300 border-amber-400/20'
        : 'bg-slate-400/10 text-[#496281] border-slate-400/20';
  return <span className={'inline-flex whitespace-nowrap items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ' + tone}>{status}</span>;
}

function SectionHeading({ title, detail, right }: { title: string; detail?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold tracking-tight text-[#112b50]">{title}</h2>
        {detail && <p className="mt-1 text-xs text-[#6c7f9a]">{detail}</p>}
      </div>{right}
    </div>
  );
}

function Sparkline({ rising = true }: { rising?: boolean }) {
  const points = rising ? '0,29 13,24 25,27 37,15 48,21 58,13 69,16 82,5' : '0,11 13,18 25,14 37,22 48,19 58,29 69,25 82,33';
  return <svg aria-hidden="true" viewBox="0 0 84 40" className="h-10 w-20 shrink-0">
    <polyline points={points} fill="none" stroke={rising ? '#3775f0' : '#f59e0b'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function Metric({ label, value, detail, icon: Icon, rising = true }: {
  label: string; value: string; detail: string;
  icon: typeof Wallet; rising?: boolean;
}) {
  return <div className={panel + ' min-w-0 p-5'}>
    <div className="mb-3 flex items-start justify-between">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/[0.09] text-blue-500"><Icon className="h-[18px] w-[18px]" /></div>
      <Sparkline rising={rising} />
    </div>
    <div className="truncate text-2xl font-bold tracking-tight text-[#112b50]">{value}</div>
    <div className="mt-1 text-xs font-medium text-[#496281]">{label}</div>
    <div className="mt-2 text-xs text-[#7d8fa8]">{detail}</div>
  </div>;
}

function PortfolioChart({ period, setPeriod }: { period: string; setPeriod: (p: string) => void }) {
  const data = period === '7D' ? LIQUIDITY_POINTS.slice(-3) : period === '30D' ? LIQUIDITY_POINTS.slice(-5) : LIQUIDITY_POINTS;
  return <section className={panel + ' min-w-0 p-5'}>
    <SectionHeading title="Treasury balance over time" detail="Simulated holdings · USD millions" right={<div className="flex gap-1 rounded-lg bg-[#f1f6ff] p-1">
      {['7D','30D','90D'].map(p => <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p}
        className={'rounded-md px-2.5 py-1.5 text-[11px] font-medium ' + (period === p ? 'bg-blue-600/20 text-blue-700' : 'text-[#6c7f9a] hover:text-[#112b50]')}>{p}</button>)}
    </div>} />
    <div className="mt-6 h-[242px] w-full" aria-label="Chart showing positive simulated treasury growth">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: -24, right: 4, top: 10, bottom: 0 }}>
          <defs><linearGradient id="demoTreasuryGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3775f0" stopOpacity={0.28} /><stop offset="100%" stopColor="#3775f0" stopOpacity={0} />
          </linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#dce7f6" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill:'#6e88a8', fontSize:11 }} dy={12} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill:'#6e88a8', fontSize:11 }} domain={[3.5,4.5]} tickFormatter={v => '$'+v.toFixed(1)+'M'} />
          <Tooltip contentStyle={{ background:'#ffffff', border:'1px solid #d7e4f8', color:'#fff', borderRadius:10 }} formatter={(v: any) => ['$'+Number(v).toFixed(2)+'M','Portfolio']} />
          <Area name="Treasury total" type="monotone" dataKey="total" stroke="#3775f0" strokeWidth={2.6} fill="url(#demoTreasuryGradient)" dot={false} activeDot={{ r:5 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    <p className="mt-2 text-xs text-[#7d8fa8]">Illustrative historical trend — not a live financial balance.</p>
  </section>;
}

function AssetChart() {
  return <section className={panel + ' min-w-0 p-5'}>
    <SectionHeading title="Asset distribution" detail="Exposure across supported asset types" />
    <div className="mt-4 grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_1fr]">
      <div className="relative h-[190px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart><Pie data={ASSET_MIX} dataKey="value" innerRadius={65} outerRadius={86} paddingAngle={3} stroke="none">
            {ASSET_MIX.map(item => <Cell key={item.name} fill={item.color} />)}
          </Pie><Tooltip formatter={(v: any) => money(Number(v))} contentStyle={{ background:'#ffffff', border:'1px solid #d7e4f8', borderRadius:10 }} /></PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <strong className="text-lg text-[#112b50]">$4.22M</strong><span className="text-[10px] text-[#6c7f9a]">Total assets</span>
        </div>
      </div>
      <div className="space-y-3">
        {ASSET_MIX.map(item => <div key={item.name} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-2 text-[#496281]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor:item.color }} />{item.name}</span>
          <span className="font-medium tabular-nums text-[#294468]">{Math.round(item.value / 4218350 * 100)}%</span>
        </div>)}
      </div>
    </div>
    <div className="mt-3 border-t border-[#dce7f5] pt-3 text-xs text-[#7d8fa8]">Ethereum · Solana · fiat banking</div>
  </section>;
}

function CashflowChart() {
  return <section className={panel + ' p-5'}>
    <SectionHeading title="Cash-flow activity" detail="Simulated inflows and outflows · USD thousands" />
    <div className="mt-5 h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={CASH_FLOW} barGap={3} margin={{ left:-22, top:8, right:0 }}>
          <CartesianGrid stroke="#dce7f6" vertical={false} />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill:'#6e88a8',fontSize:11 }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill:'#6e88a8',fontSize:11 }} tickFormatter={v=>'$'+v+'k'} />
          <Tooltip contentStyle={{ background:'#ffffff',border:'1px solid #d7e4f8',borderRadius:10 }} />
          <Bar dataKey="inflow" name="Inflows ($k)" fill="#3775f0" radius={[4,4,0,0]} maxBarSize={22}/>
          <Bar dataKey="outflow" name="Outflows ($k)" fill="#9cafea" radius={[4,4,0,0]} maxBarSize={22}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div className="mt-2 flex flex-wrap justify-center gap-5 text-xs text-[#6c7f9a]"><span><span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-500"/>Inflows</span><span><span className="mr-2 inline-block h-2 w-2 rounded-full bg-indigo-400"/>Outflows</span></div>
  </section>;
}

function Insights({ onOpen }: { onOpen: (slug: string) => void }) {
  const insights = [
    { title: 'Optimize idle stablecoins', desc: '$225K available for simulated yield allocation', icon: TrendingUp, tone:'text-blue-500', slug:'yield' },
    { title: 'Review treasury approval', desc: 'Two proposed transfers require authorization', icon: CheckCircle2, tone:'text-amber-300', slug:'approvals' },
    { title: 'Forecast reserve coverage', desc: 'Projected 30-day operating liquidity is healthy', icon: BrainCircuit, tone:'text-sky-300', slug:'treasury' },
  ];
  return <div className={panel + ' p-5'}>
    <SectionHeading title="AI treasury insights" detail="Sample recommendations generated for this workspace" right={<Sparkles className="h-4 w-4 text-blue-500" />} />
    <div className="mt-5 space-y-2">
      {insights.map((insight) => <button key={insight.title} onClick={() => onOpen(insight.slug)} className="flex w-full items-start gap-3 rounded-xl border border-[#dce7f5] bg-[#f1f6ff] p-3 text-left transition hover:border-blue-500/25 hover:bg-[#f1f6ff]">
        <span className={'mt-0.5 rounded-lg bg-[#f1f6ff] p-2 ' + insight.tone}><insight.icon className="h-4 w-4"/></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-[#183153]">{insight.title}</span><span className="mt-1 block text-xs leading-relaxed text-[#6c7f9a]">{insight.desc}</span></span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-[#7d8fa8]" />
      </button>)}
    </div>
  </div>;
}

export function DemoApplication() {
  const pathname = usePathname();
  const slug = pathname?.split('/').filter(Boolean)[1] || 'dashboard';
  const activeSlug = DEMO_SURFACES[slug] ? slug : 'dashboard';
  const surface = DEMO_SURFACES[activeSlug];
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All statuses');
  const [period, setPeriod] = useState('90D');
  const [selected, setSelected] = useState<DemoRow | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState('Ethereum');
  const [feedback, setFeedback] = useState('');
  const [demoData, setDemoData] = useState<DemoPersisted>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantQuery, setAssistantQuery] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState('');

  useEffect(() => {
    try {
      setSidebarExpanded(localStorage.getItem('latitude-concept-sidebar-expanded') !== 'false');
    } catch { /* Collapsing still works without local storage. */ }
  }, []);

  function toggleSidebar() {
    const next = !sidebarExpanded;
    setSidebarExpanded(next);
    try { localStorage.setItem('latitude-concept-sidebar-expanded', String(next)); } catch { /* optional persistence */ }
  }

  useEffect(() => {
    try { const saved = sessionStorage.getItem(storageKey); if (saved) {
      const parsed = JSON.parse(saved) as DemoPersisted;
      if (parsed && typeof parsed === 'object' && parsed.added && parsed.statuses) setDemoData(parsed);
    }} catch { /* Demo works without browser storage. */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(demoData)); } catch { /* ephemeral demo */ }
  }, [demoData, hydrated]);
  useEffect(() => {
    setMenuOpen(false); setSearch(''); setFilter('All statuses'); setFeedback(''); setSelected(null); setActionOpen(false);
  }, [activeSlug]);

  const rows = useMemo(() => {
    const combined = [...(demoData.added[activeSlug] || []), ...surface.rows];
    return combined.map(r => ({ ...r, status: demoData.statuses[r.id] || r.status }));
  }, [demoData, activeSlug, surface]);
  const statuses = useMemo(() => ['All statuses', ...Array.from(new Set(rows.map(r=>r.status)))], [rows]);
  const filtered = useMemo(() => rows.filter(r =>
    (filter === 'All statuses' || r.status === filter)
    && [r.name,r.detail,r.amount,r.status,r.network].join(' ').toLowerCase().includes(search.trim().toLowerCase())
  ), [rows, search, filter]);

  function navigate(target: string) { window.location.assign('/demo/' + target); }
  function updateStatus(id: string, status: string) {
    setDemoData(prev => ({ ...prev, statuses: { ...prev.statuses, [id]:status } }));
    setSelected(null); setFeedback('Sample record updated locally. No production data was changed.');
  }
  function createSimulation() {
    if (!recipient.trim() || !(Number(amount) > 0)) {
      setFeedback('Enter a description and an amount greater than zero.'); return;
    }
    const newRow: DemoRow = {
      id:'demo-' + Date.now(), name:recipient.trim().slice(0,100), detail:'Created in this browser session · simulated',
      amount:money(Number(amount)), status: activeSlug==='approvals' ? 'Pending' : 'Scheduled',
      date:'Just now', network,
    };
    setDemoData(prev => ({ ...prev, added: { ...prev.added, [activeSlug]:[newRow, ...(prev.added[activeSlug] || [])] } }));
    setActionOpen(false); setRecipient(''); setAmount('');
    setFeedback('Simulation created successfully. No funds, payments, or external services were affected.');
  }
  function downloadCsv() {
    const csv = [['Name','Detail','Amount','Status','Date','Network'], ...filtered.map(r=>[r.name,r.detail,r.amount,r.status,r.date,r.network||''])]
      .map(items=>items.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv],{ type:'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'latitude-concept-' + activeSlug + '.csv'; a.click();
    URL.revokeObjectURL(url);
    setFeedback('Demo CSV exported with simulated data.');
  }
  function runAction() {
    if (surface.action==='Export CSV') return downloadCsv();
    if (surface.action==='Mark all as read') {
      setDemoData(prev => ({
        ...prev, statuses: {
          ...prev.statuses, ...Object.fromEntries(rows.map(r=>[r.id,'Read'])),
        },
      }));
      setFeedback('Demo notifications marked as read.'); return;
    }
    setFeedback(''); setActionOpen(true);
  }
  function clearSimulation() {
    setDemoData(initialState);
    setSearch('');setFilter('All statuses');setSelected(null);
    setFeedback('Demo session reset to its original sample data.');
  }
  function askAssistant(query: string) {
    setAssistantQuery(query);
    const q = query.toLowerCase();
    setAssistantAnswer(q.includes('yield')
      ? 'This sample workspace shows $1.375M in yield positions, with an illustrative 4.8% blended APY. Explore the Yield surface to inspect the positions.'
      : q.includes('approval') || q.includes('policy')
        ? 'Two sample approvals are pending. The Policy page shows active cash-reserve, outflow and concentration controls.'
        : q.includes('transfer') || q.includes('payment')
          ? 'The Operations section includes interactive sample transfers, payments and simulated settlement workflows. No transactions are broadcast.'
          : 'This sample global finance workspace has $4.22M in combined assets, including Ethereum and Solana stablecoins and connected fiat accounts. Explore Treasury AI for suggestions.');
  }

  const isDashboard = activeSlug === 'dashboard';
  const isAnalytics = activeSlug === 'analytics';
  const isTreasury = activeSlug === 'treasury';
  const isYield = activeSlug === 'yield';
  const anyCharts = isDashboard || isAnalytics || isTreasury || isYield;
  const showFlows = isDashboard || isAnalytics;
  const rowsTitle = isDashboard ? 'Connected treasury assets' : isTreasury ? 'Intelligence & recommendations' : isAnalytics ? 'Saved analytics views' : 'Recent ' + surface.title.toLowerCase();
  const displayAction = surface.action || 'Explore records';

  return <div className="latitude-blue h-screen overflow-hidden bg-[#f3f7fd] text-[#183153]" data-demo="true">
    <div className="flex h-full overflow-hidden">
      {menuOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/70 lg:hidden" onClick={()=>setMenuOpen(false)} />}
      <aside aria-label="Latitude sidebar" className={
        'latitude-nav fixed inset-y-0 left-0 z-40 flex w-[244px] shrink-0 flex-col overflow-hidden border-r border-[#dce7f5] bg-[#ffffff] text-[#112b50] transition-[width,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] lg:relative lg:inset-auto lg:h-full lg:translate-x-0 ' +
        (menuOpen ? 'translate-x-0 shadow-[0_0_40px_rgba(0,0,0,0.5)]' : '-translate-x-full') +
        (sidebarExpanded ? ' lg:w-56' : ' lg:w-16')
      }>
        <div className="latitude-nav-head relative flex h-16 shrink-0 items-center justify-center border-b border-[#dce7f5] px-3">
          <img alt="Latitude" src="/latitude-wordmark-white.svg" className={'h-9 w-[165px] shrink-0 object-contain object-center '+(sidebarExpanded?'':'lg:hidden')}/>
          <img alt="Latitude" src="/latitude-mark-white.svg" className={'hidden h-9 w-9 shrink-0 object-contain '+(sidebarExpanded?'':'lg:block')}/>
          <button onClick={()=>setMenuOpen(false)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/80 hover:text-white lg:hidden" aria-label="Close menu"><X className="h-5 w-5"/></button>
        </div>
        <div className={'latitude-workspace-switcher mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-xl border border-blue-500/15 bg-blue-500/[0.045] px-2 py-2.5 ' + (sidebarExpanded ? '' : 'lg:mx-2 lg:justify-center lg:gap-0 lg:px-1')}>
          <div className="latitude-workspace-avatar flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#dfeaff] text-sm font-semibold text-blue-800">N</div>
          <div className={'min-w-0 flex-1 ' + (sidebarExpanded ? '' : 'lg:hidden')}>
            <div className="truncate text-xs font-semibold text-[#112b50]">Northstar Holdings</div>
            <div className="mt-1 truncate text-[11px] text-blue-500">Enterprise · Test account</div>
          </div>
          <ChevronDown className={'h-4 w-4 shrink-0 text-[#6c7f9a] ' + (sidebarExpanded ? '' : 'lg:hidden')}/>
        </div>
        <nav aria-label="Demo navigation" className={'demo-sidebar-scroll mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 py-1 pb-5 ' + (sidebarExpanded ? 'space-y-4' : 'space-y-2')}>
          {DEMO_GROUPS.map(group=><div key={group.name}>
            <div className={'latitude-group-label mb-1 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[#7d8fa8] ' + (sidebarExpanded ? '' : 'lg:hidden')}>{group.name}</div>
            <div className="space-y-1">
              {group.items.map(item=><Link key={item.slug} href={'/demo/'+item.slug} onClick={()=>setMenuOpen(false)}
                aria-current={item.slug===activeSlug?'page':undefined}
                aria-label={item.title}
                title={!sidebarExpanded ? item.title : undefined}
                className={'group flex min-h-10 items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ' +
                  (sidebarExpanded ? '' : 'lg:justify-center lg:gap-0 lg:px-1') + ' ' +
                  (item.slug===activeSlug ? 'border-blue-500 bg-[#eaf1fe] font-semibold text-[#112b50]' : 'border-transparent text-[#647997] hover:bg-[#f1f6ff] hover:text-[#203a60]')}>
                <item.icon className="h-[19px] w-[19px] shrink-0"/>
                <span className={'min-w-0 flex-1 whitespace-nowrap ' + (sidebarExpanded ? '' : 'lg:hidden')}>{item.title}</span>
              </Link>)}
            </div>
          </div>)}
        </nav>
        <div className="latitude-nav-bottom shrink-0 border-t border-[#dce7f5]">
          <div className={'px-3 pt-3 ' + (sidebarExpanded ? '' : 'lg:hidden')}>
            <div className="flex items-center gap-2 text-[11px] text-[#7185a2]"><ShieldCheck className="h-4 w-4 shrink-0 text-blue-500"/>Safe simulated environment</div>
          </div>
          <button onClick={clearSimulation} title={!sidebarExpanded?'Reset demo session':undefined} aria-label="Reset demo session"
            className={'flex w-full items-center gap-2 px-4 py-3 text-left text-[11px] font-medium text-[#7185a2] hover:bg-[#f1f6ff] hover:text-[#203a60] ' + (sidebarExpanded ? '' : 'lg:justify-center lg:px-2')}>
            <RefreshCw className="h-4 w-4 shrink-0"/><span className={sidebarExpanded ? '' : 'lg:hidden'}>Reset demo session</span>
          </button>
          <button type="button" aria-label={menuOpen?'Close sidebar':sidebarExpanded?'Collapse sidebar':'Expand sidebar'}
            title={menuOpen?'Close sidebar':sidebarExpanded?'Collapse sidebar':'Expand sidebar'}
            aria-expanded={sidebarExpanded}
            onClick={()=>{if(menuOpen)setMenuOpen(false);else toggleSidebar();}}
            className="group flex h-10 w-full shrink-0 items-center justify-center border-t border-[#dce7f5] text-[#8295ad] transition-colors hover:bg-[#f1f6ff] hover:text-[#405a7a]">
            <ChevronLeft className={'h-4 w-4 transition-transform duration-300 ' + (sidebarExpanded ? '' : 'lg:rotate-180')}/>
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-blue-500/15 bg-[#ebf2ff] px-4 py-2 text-center text-[11px] font-medium text-blue-700">
          <ShieldCheck className="h-3.5 w-3.5"/><span>UNOFFICIAL LATITUDE CONCEPT</span>
          <span className="text-blue-700/65">· Exploratory prototype, not an official Latitude product · No real funds or accounts</span>
        </div>
        <header className="latitude-header relative z-20 flex h-[68px] shrink-0 items-center justify-between gap-3 border-b border-[#dce7f5] bg-[#ffffff]/95 px-4 backdrop-blur-xl sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={()=>setMenuOpen(true)} aria-label="Open navigation" className="rounded-lg p-2 text-[#6c7f9a] hover:bg-[#f1f6ff] lg:hidden"><Menu className="h-5 w-5"/></button>
            <span className="latitude-crumb hidden text-sm text-[#7d8fa8] sm:inline">Workspace</span>
            <ChevronRight className="latitude-crumb hidden h-4 w-4 text-[#8e9fb4] sm:inline"/>
            <span className="latitude-header-title truncate text-sm font-semibold text-[#112b50]">{surface.title}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="latitude-status hidden items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/[0.055] px-3 py-1.5 text-xs text-blue-500 sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-blue-500"/>Test mode active</span>
            <button onClick={()=>navigate('notifications')} aria-label="View notifications" className="relative rounded-lg p-2 text-[#6c7f9a] hover:bg-[#f1f6ff] hover:text-[#112b50]"><Bell className="h-5 w-5"/><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-500"/></button>
            <button onClick={()=>setAssistantOpen(true)} aria-label="Open demo assistant" className="rounded-lg p-2 text-[#6c7f9a] hover:bg-[#f1f6ff] hover:text-[#112b50]"><BrainCircuit className="h-5 w-5"/></button>
            <div className="latitude-header-avatar flex h-8 w-8 items-center justify-center rounded-full border border-blue-500/30 bg-[#dfeaff] text-xs font-semibold text-[#112b50]">NL</div>
          </div>
        </header>

        <main id="main-content" className="latitude-main demo-main-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 sm:p-8">
          <div className="mx-auto w-full max-w-[1440px] space-y-6 pb-12">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.14em] text-blue-500"><span className="h-1.5 w-1.5 rounded-full bg-blue-500"/>Northstar Holdings · Global finance workspace</div>
              <h1 className="text-2xl font-semibold tracking-tight text-[#112b50] sm:text-[30px]">{surface.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#6c7f9a]">{surface.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={downloadCsv} className={button+' border border-[#dce7f5] bg-[#f1f6ff] text-[#294468] hover:bg-[#f1f6ff]'}><Download className="h-4 w-4"/>Export</button>
              {surface.action && <button onClick={runAction} className={button+' bg-blue-600 font-semibold text-white hover:bg-blue-500'}><Plus className="h-4 w-4"/>{displayAction}</button>}
            </div>
          </div>

          {feedback && <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.055] px-4 py-3 text-sm text-blue-800"><span>{feedback}</span><button onClick={()=>setFeedback('')} aria-label="Dismiss message"><X className="h-4 w-4"/></button></div>}

          {isDashboard ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Wallet} value="$4,218,350" label="Total treasury assets" detail="+8.4% over 90 days"/>
            <Metric icon={ArrowLeftRight} value="$2,150,000" label="Digital assets" detail="USDC + USDT · 2 networks"/>
            <Metric icon={Globe2} value="$2,068,350" label="Fiat balances · USD equiv." detail="9 simulated bank accounts"/>
            <Metric icon={TrendingUp} value="$5,486" label="Yield earned · 30 days" detail="4.8% illustrative blended APY"/>
          </div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Metric icon={activeSlug==='yield'?TrendingUp:activeSlug==='wallets'?Wallet:BarChart3} value={surface.headline} label={surface.headlineLabel} detail="Sample account · not live"/>
            <Metric icon={CheckCircle2} value={surface.supporting} label={surface.supportingLabel} detail="Updated for this demo"/>
            <div className={panel+' flex min-h-[163px] flex-col justify-between p-5'}>
              <div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#496281]">Workspace health</span><ShieldCheck className="h-5 w-5 text-blue-500"/></div>
              <div><div className="text-[24px] font-semibold text-[#112b50]">Operational</div><span className="mt-1 block text-xs text-[#6c7f9a]">All external integrations disabled in demo</span></div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-500"><span className="h-1.5 w-1.5 rounded-full bg-blue-500"/>Sample data loaded</span>
            </div>
          </div>}

          {anyCharts && <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
            <PortfolioChart period={period} setPeriod={setPeriod}/><AssetChart/>
          </div>}
          {showFlows && <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
            <CashflowChart/><Insights onOpen={navigate}/>
          </div>}
          {(isTreasury || isYield) && <Insights onOpen={navigate}/>}

          <section className={panel+' overflow-hidden'}>
            <div className="space-y-4 border-b border-[#dce7f5] p-5">
              <SectionHeading title={rowsTitle} detail={rows.length+' sample records · select a row to inspect details'} right={<span className="flex items-center gap-1.5 text-xs text-[#7d8fa8]"><Clock3 className="h-3.5 w-3.5"/>Demo dataset</span>} />
              <div className="flex flex-wrap gap-2">
                <label className="relative min-w-[190px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-[11px] h-4 w-4 text-[#7d8fa8]"/>
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={'Search '+surface.title.toLowerCase()+'…'}
                    aria-label="Search demo records" className="w-full rounded-lg border border-[#dce7f5] bg-[#f6f9ff] py-2.5 pl-9 pr-3 text-xs text-[#112b50] outline-none placeholder:text-[#7d8fa8] focus:border-blue-500/50"/>
                </label>
                <label className="relative">
                  <span className="sr-only">Filter by status</span>
                  <select value={filter} onChange={e=>setFilter(e.target.value)}
                    className="min-w-[148px] rounded-lg border border-[#dce7f5] bg-[#f6f9ff] px-3 py-2.5 text-xs text-[#294468] outline-none focus:border-blue-500/50">
                    {statuses.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                {(search || filter!=='All statuses') && <button onClick={()=>{setSearch('');setFilter('All statuses');}} className={button+' border border-[#dce7f5] text-xs text-[#496281]'}>Clear filters</button>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead className="bg-[#f1f6ff] text-[11px] font-semibold uppercase tracking-[.08em] text-[#7d8fa8]">
                  <tr><th className="px-5 py-3.5">Name / activity</th><th className="px-4 py-3.5">Amount / value</th><th className="px-4 py-3.5">Network / type</th><th className="px-4 py-3.5">Status</th><th className="px-4 py-3.5">Date</th><th className="px-3 py-3.5"><span className="sr-only">Details</span></th></tr>
                </thead>
                <tbody className="divide-y divide-[#e1eaf6]">
                  {filtered.map(r=><tr key={r.id} onClick={()=>setSelected(r)} tabIndex={0} role="button" aria-label={'Inspect '+r.name}
                    onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(r);}}}
                    className="cursor-pointer transition hover:bg-blue-500/[0.035] focus:bg-[#f1f6ff] focus:outline-none">
                    <td className="px-5 py-4"><div className="text-[13px] font-medium text-[#183153]">{r.name}</div><div className="mt-1 text-xs text-[#7d8fa8]">{r.detail}</div></td>
                    <td className="px-4 py-4 text-[13px] font-semibold tabular-nums text-[#294468]">{r.amount}</td>
                    <td className="px-4 py-4 text-xs text-[#6c7f9a]">{r.network||'—'}</td>
                    <td className="px-4 py-4"><StatusPill status={r.status}/></td>
                    <td className="px-4 py-4 whitespace-nowrap text-xs text-[#6c7f9a]">{r.date}</td>
                    <td className="px-3 py-4 text-[#8e9fb4]"><ChevronRight className="h-4 w-4"/></td>
                  </tr>)}
                </tbody>
              </table>
              {filtered.length===0&&<div className="px-6 py-12 text-center text-sm text-[#6c7f9a]">No demo records match your filters. <button onClick={()=>{setSearch('');setFilter('All statuses')}} className="text-blue-500 underline">Clear filters</button></div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dce7f5] px-5 py-3 text-xs text-[#7d8fa8]"><span>Showing {filtered.length} of {rows.length} records</span><span>All records are simulated</span></div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className={panel+' p-5'}>
              <div className="flex gap-3"><div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-500"><ShieldCheck className="h-5 w-5"/></div><div>
                <h3 className="text-sm font-semibold text-[#112b50]">Safe by design</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#6c7f9a]">This demonstration uses isolated, fictional records in your browser. It never invokes settlement, wallet, banking or customer-data APIs.</p>
              </div></div>
            </div>
            <div className={panel+' flex flex-col justify-between p-5'}>
              <div><h3 className="text-sm font-semibold text-[#112b50]">Keep exploring</h3><p className="mt-1 text-xs text-[#6c7f9a]">Explore a proposed Latitude global financial operations experience.</p></div>
              <button onClick={()=>navigate(activeSlug==='treasury'?'policy':'treasury')} className="mt-4 inline-flex items-center gap-2 self-start text-xs font-semibold text-blue-500 hover:text-blue-700">Explore {activeSlug==='treasury'?'policy controls':'Treasury AI'}<ArrowRight className="h-4 w-4"/></button>
            </div>
          </section>
          </div>
        </main>
      </div>
    </div>

    <button onClick={()=>setAssistantOpen(true)} aria-label="Open interactive demo assistant"
      className="fixed bottom-5 right-5 z-20 flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-600 text-white shadow-[0_8px_32px_#3775f045] transition hover:scale-105"><BrainCircuit className="h-6 w-6"/></button>

    {selected && <div className="fixed inset-0 z-50 flex justify-end bg-black/65" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
      <aside aria-label="Demo record details" role="dialog" aria-modal="true" className="flex h-full w-full max-w-[490px] flex-col overflow-y-auto border-l border-[#dce7f5] bg-[#ffffff] p-6 shadow-2xl">
        <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[.13em] text-blue-500">Simulated record</span><button onClick={()=>setSelected(null)} aria-label="Close record details" className="rounded-lg p-2 text-[#6c7f9a] hover:bg-[#f1f6ff]"><X className="h-5 w-5"/></button></div>
        <h2 className="mt-6 text-2xl font-semibold text-[#112b50]">{selected.name}</h2><p className="mt-2 text-sm text-[#6c7f9a]">{selected.detail}</p>
        <div className="mt-7 rounded-xl border border-[#dce7f5] bg-[#ffffff] p-5"><div className="text-xs text-[#6c7f9a]">Amount / value</div><div className="mt-2 text-3xl font-semibold text-[#112b50]">{selected.amount}</div><div className="mt-3"><StatusPill status={demoData.statuses[selected.id]||selected.status}/></div></div>
        <dl className="mt-5 divide-y divide-[#e1eaf6] text-sm">
          {[['Record ID',selected.id],['Category',surface.title],['Network / type',selected.network||'—'],['Activity date',selected.date],['Environment','Simulated · no real execution']].map(([k,v])=><div key={k} className="flex justify-between gap-4 py-4"><dt className="text-[#6c7f9a]">{k}</dt><dd className="text-right text-[#294468]">{v}</dd></div>)}
        </dl>
        {activeSlug==='approvals' && (demoData.statuses[selected.id]||selected.status)==='Pending' && <div className="mt-6 flex gap-3">
          <button className={button+' flex-1 bg-blue-600 text-white'} onClick={()=>updateStatus(selected.id,'Approved')}><Check className="h-4 w-4"/>Simulate approval</button>
          <button className={button+' flex-1 border border-rose-400/25 bg-rose-400/10 text-rose-300'} onClick={()=>updateStatus(selected.id,'Denied')}><X className="h-4 w-4"/>Simulate denial</button>
        </div>}
        <div className="mt-auto pt-6 text-xs leading-relaxed text-[#7d8fa8]"><LockKeyhole className="mr-1 inline h-4 w-4"/>All record details are fictional. This prototype is not connected to Latitude.</div>
      </aside>
    </div>}

    {actionOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={e=>{if(e.target===e.currentTarget)setActionOpen(false);}}>
      <div role="dialog" aria-modal="true" aria-label="Create demo simulation" className="w-full max-w-lg rounded-2xl border border-[#dce7f5] bg-[#ffffff] p-6 shadow-2xl">
        <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-blue-500"><Sparkles className="h-4 w-4"/>Demo interaction</span><button onClick={()=>setActionOpen(false)} aria-label="Close simulation"><X className="h-5 w-5 text-[#6c7f9a]"/></button></div>
        <h2 className="mt-4 text-xl font-semibold text-[#112b50]">{displayAction}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#6c7f9a]">Preview this workflow by creating a local sample record. No money moves and no external API is called.</p>
        <form onSubmit={e=>{e.preventDefault();createSimulation();}} className="mt-6 space-y-4">
          <label className="block text-xs font-semibold text-[#496281]">Name / description
            <input value={recipient} onChange={e=>setRecipient(e.target.value)} required maxLength={100} placeholder="Example: Supplier settlement" className="mt-2 w-full rounded-lg border border-[#dce7f5] bg-[#ffffff] px-3 py-3 text-sm text-[#112b50] outline-none focus:border-blue-500/60"/>
          </label>
          <label className="block text-xs font-semibold text-[#496281]">Simulated amount (USD)
            <input value={amount} onChange={e=>setAmount(e.target.value)} required type="number" min="0.01" max="100000000" step="0.01" placeholder="25000" className="mt-2 w-full rounded-lg border border-[#dce7f5] bg-[#ffffff] px-3 py-3 text-sm text-[#112b50] outline-none focus:border-blue-500/60"/>
          </label>
          <label className="block text-xs font-semibold text-[#496281]">Rail / network
            <select value={network} onChange={e=>setNetwork(e.target.value)} className="mt-2 w-full rounded-lg border border-[#dce7f5] bg-[#ffffff] px-3 py-3 text-sm text-[#112b50] outline-none focus:border-blue-500/60">
              <option>Ethereum</option><option>Solana</option><option>USD</option><option>USDC</option><option>EUR</option>
            </select>
          </label>
          <div className="flex items-start gap-2 rounded-lg border border-blue-500/15 bg-blue-500/[0.055] p-3 text-xs text-blue-700"><ShieldCheck className="h-4 w-4 shrink-0"/>Simulation only. Data exists in your browser session and can be reset at any time.</div>
          <div className="flex justify-end gap-2"><button type="button" onClick={()=>setActionOpen(false)} className={button+' border border-[#dce7f5] text-[#294468]'}>Cancel</button>
            <button type="submit" className={button+' bg-blue-600 font-semibold text-white hover:bg-blue-500'}>Create simulation<ArrowRight className="h-4 w-4"/></button>
          </div>
        </form>
      </div>
    </div>}

    {assistantOpen && <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/60 sm:items-stretch" onMouseDown={e=>{if(e.target===e.currentTarget)setAssistantOpen(false);}}>
      <div role="dialog" aria-modal="true" aria-label="Demo treasury assistant" className="flex h-[75vh] w-full flex-col rounded-t-2xl border border-[#dce7f5] bg-[#ffffff] shadow-2xl sm:h-full sm:max-w-[420px] sm:rounded-none">
        <div className="flex items-center gap-3 border-b border-[#dce7f5] p-5"><div className="rounded-xl bg-blue-500/10 p-2 text-blue-500"><BrainCircuit className="h-5 w-5"/></div><div className="flex-1"><div className="text-sm font-semibold text-[#112b50]">Latitude AI · Demo</div><div className="text-xs text-[#6c7f9a]">Guided sample questions · not a live AI agent</div></div><button onClick={()=>setAssistantOpen(false)} aria-label="Close assistant"><X className="h-5 w-5 text-[#6c7f9a]"/></button></div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5"><div className="rounded-xl bg-[#f1f6ff] p-4 text-sm leading-relaxed text-[#294468]">Welcome to this Latitude product concept. I can guide you through this simulated treasury workspace. Try one of the prompts below.</div>
          <div className="flex flex-wrap gap-2">{['What is our total liquidity?','Show yield opportunities','Any pending approvals?','How do transfers work?'].map(q=><button key={q} onClick={()=>askAssistant(q)} className="rounded-lg border border-[#dce7f5] px-3 py-2 text-left text-xs text-blue-700 transition hover:bg-blue-500/10">{q}</button>)}</div>
          {assistantAnswer&&<><div className="ml-auto max-w-[90%] rounded-xl bg-blue-600/20 p-3 text-sm text-blue-800">{assistantQuery}</div><div role="status" className="rounded-xl bg-[#f1f6ff] p-4 text-sm leading-relaxed text-[#294468]">{assistantAnswer}</div></>}
        </div>
        <div className="border-t border-[#dce7f5] p-5"><form onSubmit={e=>{e.preventDefault();if(assistantQuery.trim())askAssistant(assistantQuery);}} className="flex gap-2"><input value={assistantQuery} onChange={e=>setAssistantQuery(e.target.value)} placeholder="Ask about this demo…" aria-label="Ask the demo assistant" className="min-w-0 flex-1 rounded-lg border border-[#dce7f5] bg-[#ffffff] px-3 py-3 text-sm text-[#112b50] outline-none focus:border-blue-500/50"/><button type="submit" aria-label="Submit question" className="rounded-lg bg-blue-600 px-3 text-[#ffffff]"><Send className="h-4 w-4"/></button></form><p className="mt-2 text-[11px] text-[#7d8fa8]">Answers are scripted examples using fictional data.</p></div>
      </div>
    </div>}
  </div>;
}