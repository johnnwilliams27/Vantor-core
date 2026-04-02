'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Wallet,
  Building2,
  FileText,
  Send,
  ArrowLeftRight,
  Banknote,
  History,
  Shield,
  Settings,
  Users,
  ChevronLeft,
  ChevronRight,
  BrainCircuit,
  Plug,
  ShieldCheck,
  FileSearch,
  TrendingUp,
  FileBarChart,
  GitBranchPlus,
  CreditCard,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { UserRole } from '@/types/database';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole?: UserRole;
}

interface NavGroup {
  heading?: string;
  items: NavItem[];
}

const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: 'Admin Dashboard', href: '/admin', icon: LayoutDashboard },
      { label: 'Audit', href: '/audit', icon: FileSearch },
    ],
  },
];

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Treasury AI', href: '/treasury', icon: BrainCircuit, minRole: 'treasury_manager' },
      { label: 'Compliance', href: '/compliance', icon: ShieldCheck, minRole: 'accountant' },
      { label: 'Yield', href: '/yield', icon: TrendingUp, minRole: 'treasury_manager' },
    ],
  },
  {
    heading: 'Linked Accounts',
    items: [
      { label: 'Wallets', href: '/wallets', icon: Wallet, minRole: 'accountant' },
      { label: 'Bank Accounts', href: '/bank-accounts', icon: Building2, minRole: 'accountant' },
      { label: 'ERP Systems', href: '/settings/erp', icon: Settings, minRole: 'accountant' },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { label: 'Transfers', href: '/transfers', icon: Send, minRole: 'treasury_manager' },
      { label: 'Swaps', href: '/swaps', icon: ArrowLeftRight, minRole: 'treasury_manager' },
      { label: 'Bridges', href: '/bridges', icon: GitBranchPlus, minRole: 'treasury_manager' },
      { label: 'Ramps', href: '/ramps', icon: Banknote, minRole: 'treasury_manager' },
    ],
  },
  {
    heading: 'Records',
    items: [
      { label: 'Invoices', href: '/invoices', icon: FileText, minRole: 'accountant' },
      { label: 'Transactions', href: '/transactions', icon: History },
      { label: 'Audit', href: '/audit', icon: Shield },
      { label: 'Reporting', href: '/reporting', icon: FileBarChart, minRole: 'treasury_manager' },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { label: 'Account Management', href: '/settings/accounts', icon: Users, minRole: 'treasury_manager' },
      { label: 'Billing', href: '/settings/billing', icon: CreditCard, minRole: 'treasury_manager' },
      { label: 'External Integrations', href: '/settings/integrations', icon: Plug, minRole: 'treasury_manager' },
    ],
  },
];

const ROLE_RANK: Record<UserRole, number> = {
  auditor: 0,
  accountant: 1,
  treasury_manager: 2,
};

function hasAccess(userRole: string, minRole?: UserRole): boolean {
  if (!minRole) return true;
  return ROLE_RANK[userRole as UserRole] >= ROLE_RANK[minRole];
}

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { resolvedTheme } = useTheme();
  const { sidebarOpen, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useAppStore();
  const logoSrc = '/logo-dark.png';
  const userRole = session?.user?.role ?? 'auditor';
  const isAppAdmin = !!(session?.user as Record<string, unknown>)?.is_app_admin;
  const enterpriseId = session?.user?.enterprise_id;
  const [enterpriseName, setEnterpriseName] = useState<string | null>(null);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname, setMobileSidebarOpen]);

  useEffect(() => {
    if (!enterpriseId) return;
    fetch('/api/user/enterprise')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.name) setEnterpriseName(d.name); })
      .catch(() => {});
  }, [enterpriseId]);

  const navGroups = isAppAdmin ? ADMIN_NAV_GROUPS : NAV_GROUPS;

  return (
    <>
    {/* Mobile overlay backdrop */}
    {mobileSidebarOpen && (
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
        onClick={() => setMobileSidebarOpen(false)}
      />
    )}
    <aside
      className={cn(
        'flex flex-col bg-gray-900 text-white transition-all duration-300 shrink-0',
        // Desktop: static sidebar
        'hidden lg:flex',
        sidebarOpen ? 'w-56' : 'w-16',
        // Mobile: fixed overlay
        mobileSidebarOpen && '!fixed inset-y-0 left-0 z-50 !flex w-56',
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-center px-3 border-b border-white/10">
        {sidebarOpen ? (
          <Image src={logoSrc} alt="Vantor" width={140} height={46} className="object-contain" style={{ height: 'auto' }} priority unoptimized />
        ) : (
          <span className="text-lg font-bold text-white">V</span>
        )}
      </div>

      {/* Enterprise name */}
      {enterpriseName && (
        <div className={cn(
          'flex items-center border-b border-white/10 px-3 py-2',
          sidebarOpen ? 'gap-2' : 'justify-center'
        )}>
          <Building2 className="h-4 w-4 shrink-0 text-teal-400" />
          {sidebarOpen && (
            <span className="text-xs font-medium text-white/70 truncate">{enterpriseName}</span>
          )}
        </div>
      )}
      {isAppAdmin && (
        <div className={cn(
          'flex items-center border-b border-white/10 px-3 py-2',
          sidebarOpen ? 'gap-2' : 'justify-center'
        )}>
          <ShieldCheck className="h-4 w-4 shrink-0 text-amber-400" />
          {sidebarOpen && (
            <span className="text-xs font-medium text-amber-400/80 truncate">App Admin</span>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-4 overflow-y-auto">
        {navGroups.map((group, gi) => {
          const visibleItems = isAppAdmin
            ? group.items
            : group.items.filter((item) => hasAccess(userRole, item.minRole));
          if (!visibleItems.length) return null;
          return (
            <div key={gi}>
              {group.heading && sidebarOpen && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                  {group.heading}
                </p>
              )}
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const active = pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        active
                          ? 'bg-white/15 text-white'
                          : 'text-white/70 hover:bg-white/10 hover:text-white'
                      )}
                      title={!sidebarOpen ? item.label : undefined}
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {sidebarOpen && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Upgrade CTA for Lite users */}
      {sidebarOpen && session?.user?.subscription_tier === 'lite' && (
        <Link
          href="/settings/billing"
          className="group mx-3 mb-3 px-4 py-3 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-400 text-white text-sm font-semibold text-center shadow-[0_0_20px_rgba(45,212,191,0.25)] hover:shadow-[0_0_30px_rgba(45,212,191,0.45)] transition-all duration-300 flex items-center justify-center gap-2"
        >
          <span>Upgrade to Unlock Live Mode</span>
          <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
        </Link>
      )}

      {/* Toggle — on mobile closes overlay, on desktop collapses sidebar */}
      <button
        onClick={() => {
          if (mobileSidebarOpen) setMobileSidebarOpen(false);
          else toggleSidebar();
        }}
        className="flex items-center justify-center h-10 border-t border-white/10 hover:bg-white/10 transition-colors"
      >
        {sidebarOpen ? (
          <ChevronLeft className="h-4 w-4 text-white/40" />
        ) : (
          <ChevronRight className="h-4 w-4 text-white/40" />
        )}
      </button>
    </aside>
    </>
  );
}
