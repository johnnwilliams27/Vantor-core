'use client';
import { signOut, useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { Bot, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/appStore';
import { SettingsMenu } from './SettingsMenu';
import { TestModeToggle } from './TestModeToggle';
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel';
import { AssetCapBanner } from '@/components/billing/AssetCapBanner';
import { PastDueBanner } from '@/components/billing/PastDueBanner';
import { HoverTooltip } from '@/components/ui/hover-tooltip';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/treasury': 'Treasury AI',
  '/compliance': 'Compliance',
  '/yield': 'Yield',
  '/wallets': 'Wallets',
  '/bank-accounts': 'Bank Accounts',
  '/settings/erp': 'ERP Systems',
  '/invoices': 'Invoices',
  '/transfers': 'Transfers',
  '/swaps': 'Swaps',
  '/bridges': 'Bridges',
  '/ramps': 'On/Off Ramps',
  '/payments': 'Payments',
  '/transactions': 'Transactions',
  '/audit': 'Audit',
  '/approvals': 'Approvals',
  '/analytics': 'Analytics',
  '/reporting': 'Reporting',
  '/policy': 'Policy',
  '/policy/history': 'Evaluation History',
  '/policy/versions': 'Policy Versions',
  '/settings/accounts': 'Account Management',
  '/settings/billing': 'Billing',
  '/settings/integrations': 'External Integrations',
  '/settings/notifications': 'Notifications',
  '/admin': 'Admin Dashboard',
};

const ROLE_COLORS: Record<string, string> = {
  app_admin: 'bg-amber-500/8 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  treasury_manager: 'bg-muted text-muted-foreground',
  accountant: 'bg-muted text-muted-foreground',
  auditor: 'bg-muted text-muted-foreground',
};

export function Topbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const isAppAdmin = !!session?.user?.is_app_admin;
  const role = isAppAdmin ? 'app_admin' : (session?.user?.role ?? 'auditor');
  const { agentPanelOpen, toggleAgentPanel, toggleMobileSidebar } = useAppStore();
  const title = PAGE_TITLES[pathname] ?? PAGE_TITLES[Object.keys(PAGE_TITLES).find(k => pathname.startsWith(k)) ?? ''];

  return (
    <div className="shrink-0">
      <AssetCapBanner />
      <PastDueBanner />
    <header className="relative z-10 flex h-16 items-center justify-between glass-strong border-b border-border/60 px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleMobileSidebar}
          className="lg:hidden p-1.5 rounded-md hover:bg-muted transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5 text-muted-foreground" />
        </button>
        {title && <h1 className="text-xl font-bold text-foreground tracking-tight">{title}</h1>}
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <span className="hidden sm:inline-flex">
          {!isAppAdmin && <TestModeToggle />}
        </span>

        <HoverTooltip label="Toggle Vantor AI" side="bottom">
          <button
            onClick={toggleAgentPanel}
            className={cn(
              'relative p-2 rounded-lg transition-colors',
              agentPanelOpen
                ? 'bg-primary/10 text-primary dark:bg-teal-500/20 dark:text-teal-300'
                : 'hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground'
            )}
            aria-label="Toggle Vantor AI assistant"
          >
            <Bot className="h-5 w-5" />
          </button>
        </HoverTooltip>

        <NotificationsPanel />

        <SettingsMenu
          userInitial={session?.user?.name?.charAt(0).toUpperCase() ?? 'U'}
          userName={session?.user?.name ?? undefined}
          userEmail={session?.user?.email ?? undefined}
          userRole={role}
          onSignOut={() => signOut({ callbackUrl: '/' })}
        />
      </div>
    </header>
    </div>
  );
}
