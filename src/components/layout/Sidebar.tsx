'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
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

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Treasury AI', href: '/treasury', icon: BrainCircuit, minRole: 'treasury_manager' },
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
      { label: 'Invoices', href: '/invoices', icon: FileText, minRole: 'accountant' },
      { label: 'Payments', href: '/payments', icon: Send, minRole: 'treasury_manager' },
      { label: 'Swaps', href: '/swaps', icon: ArrowLeftRight, minRole: 'treasury_manager' },
      { label: 'Ramps', href: '/ramps', icon: Banknote, minRole: 'treasury_manager' },
    ],
  },
  {
    heading: 'Records',
    items: [
      { label: 'Transactions', href: '/transactions', icon: History },
      { label: 'Audit Trail', href: '/audit', icon: Shield },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { label: 'Account Management', href: '/settings/accounts', icon: Users, minRole: 'treasury_manager' },
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
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const logoSrc = resolvedTheme === 'light' ? '/logo-light.png' : '/logo-dark.png';
  const userRole = session?.user?.role ?? 'auditor';

  return (
    <aside
      className={cn(
        'flex flex-col bg-gray-900 text-white transition-all duration-300 shrink-0',
        sidebarOpen ? 'w-56' : 'w-16'
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

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group, gi) => {
          const visibleItems = group.items.filter((item) => hasAccess(userRole, item.minRole));
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

      {/* Toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center h-10 border-t border-white/10 hover:bg-white/10 transition-colors"
      >
        {sidebarOpen ? (
          <ChevronLeft className="h-4 w-4 text-white/40" />
        ) : (
          <ChevronRight className="h-4 w-4 text-white/40" />
        )}
      </button>
    </aside>
  );
}
