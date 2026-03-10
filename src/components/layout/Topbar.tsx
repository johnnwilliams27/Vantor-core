'use client';
import { signOut, useSession } from 'next-auth/react';
import { Bot, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/appStore';
import { SettingsMenu } from './SettingsMenu';
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel';

const ROLE_COLORS: Record<string, string> = {
  treasury_manager: 'bg-[#207679]/10 text-[#195a5c] dark:bg-teal-500/15 dark:text-teal-300',
  accountant: 'bg-[#207679]/10 text-[#207679] dark:bg-teal-500/15 dark:text-teal-300',
  auditor: 'bg-black/5 text-muted-foreground dark:bg-white/10 dark:text-muted-foreground',
};

export function Topbar({ title }: { title?: string }) {
  const { data: session } = useSession();
  const role = session?.user?.role ?? 'auditor';
  const { agentPanelOpen, toggleAgentPanel } = useAppStore();

  return (
    <header className="relative z-10 flex h-16 items-center justify-between glass-strong border-b border-border/60 px-6 shrink-0">
      <div>
        {title && <h1 className="text-lg font-semibold text-foreground">{title}</h1>}
      </div>

      <div className="flex items-center gap-4">
        <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full', ROLE_COLORS[role] ?? ROLE_COLORS.auditor)}>
          {role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
        </span>

        <button
          onClick={toggleAgentPanel}
          className={cn(
            'relative p-2 rounded-lg transition-colors',
            agentPanelOpen
              ? 'bg-[#207679]/10 text-[#207679] dark:bg-teal-500/20 dark:text-teal-300'
              : 'hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground'
          )}
          title="Toggle Vantor AI"
          aria-label="Toggle Vantor AI assistant"
        >
          <Bot className="h-5 w-5" />
        </button>

        <NotificationsPanel />

        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[#207679] text-white text-xs font-semibold">
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
          onClick={() => signOut({ callbackUrl: '/login' })}
          title="Sign out"
        >
          <LogOut className="h-5 w-5 text-muted-foreground" />
        </Button>
      </div>
    </header>
  );
}
