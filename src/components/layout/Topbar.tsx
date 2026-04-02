'use client';
import { signOut, useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { Bot, LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/appStore';
import { SettingsMenu } from './SettingsMenu';
import { TestModeToggle } from './TestModeToggle';
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel';
import { AssetCapBanner } from '@/components/billing/AssetCapBanner';
import { PastDueBanner } from '@/components/billing/PastDueBanner';

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
  '/ramps': 'Ramps',
  '/transactions': 'Transactions',
  '/audit': 'Audit',
  '/settings/accounts': 'Account Management',
  '/settings/billing': 'Billing',
  '/settings/integrations': 'External Integrations',
  '/admin': 'Admin Dashboard',
};

const ROLE_COLORS: Record<string, string> = {
  app_admin: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  treasury_manager: 'bg-[#19595b]/10 text-[#134849] dark:bg-teal-500/15 dark:text-teal-300',
  accountant: 'bg-[#19595b]/10 text-[#19595b] dark:bg-teal-500/15 dark:text-teal-300',
  auditor: 'bg-black/5 text-muted-foreground dark:bg-white/10 dark:text-muted-foreground',
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
        {title && <h1 className="text-lg font-semibold text-foreground">{title}</h1>}
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <span className="hidden sm:inline-flex">
          {!isAppAdmin && <TestModeToggle />}
        </span>

        <span className={cn('hidden sm:inline-flex text-xs font-medium px-2.5 py-1 rounded-full', ROLE_COLORS[role] ?? ROLE_COLORS.auditor)}>
          {role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
        </span>

        <button
          onClick={toggleAgentPanel}
          className={cn(
            'relative p-2 rounded-lg transition-colors',
            agentPanelOpen
              ? 'bg-[#19595b]/10 text-[#19595b] dark:bg-teal-500/20 dark:text-teal-300'
              : 'hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground'
          )}
          title="Toggle Vantor AI"
          aria-label="Toggle Vantor AI assistant"
        >
          <Bot className="h-5 w-5" />
        </button>

        <NotificationsPanel />

        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[#19595b] text-white text-xs font-semibold">
            {session?.user?.name?.charAt(0).toUpperCase() ?? 'U'}
          </div>
          {session?.user?.email && (
            <span className="hidden sm:block text-sm text-muted-foreground">
              {session.user.email}
            </span>
          )}
        </div>

        <SettingsMenu />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => signOut({ callbackUrl: '/' })}
          title="Sign out"
        >
          <LogOut className="h-5 w-5 text-muted-foreground" />
        </Button>
      </div>
    </header>
    </div>
  );
}
