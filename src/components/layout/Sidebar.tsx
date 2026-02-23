'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Wallet,
  FileText,
  Send,
  ArrowLeftRight,
  History,
  Shield,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { UserRole } from '@/types/database';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole?: UserRole;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Wallets', href: '/wallets', icon: Wallet, minRole: 'accountant' },
  { label: 'Invoices', href: '/invoices', icon: FileText, minRole: 'accountant' },
  { label: 'Payments', href: '/payments', icon: Send, minRole: 'treasury_manager' },
  { label: 'Swaps', href: '/swaps', icon: ArrowLeftRight, minRole: 'treasury_manager' },
  { label: 'Transactions', href: '/transactions', icon: History },
  { label: 'Audit Trail', href: '/audit', icon: Shield },
  { label: 'ERP Settings', href: '/settings/erp', icon: Settings, minRole: 'accountant' },
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
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const userRole = session?.user?.role ?? 'auditor';

  return (
    <aside
      className={cn(
        'flex flex-col bg-[#207679] text-white transition-all duration-300 shrink-0',
        sidebarOpen ? 'w-56' : 'w-16'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-center px-3 border-b border-white/10">
        {sidebarOpen ? (
          <Image src="/logo.png" alt="Vantor" width={140} height={46} className="object-contain" priority unoptimized />
        ) : (
          <span className="text-lg font-bold text-white">V</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {NAV_ITEMS.filter((item) => hasAccess(userRole, item.minRole)).map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-[#195a5c] text-white'
                  : 'text-white/80 hover:bg-white/15 hover:text-white'
              )}
              title={!sidebarOpen ? item.label : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center h-10 border-t border-white/10 hover:bg-white/10 transition-colors"
      >
        {sidebarOpen ? (
          <ChevronLeft className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" />
        )}
      </button>
    </aside>
  );
}
