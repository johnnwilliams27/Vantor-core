'use client';
import { signOut, useSession } from 'next-auth/react';
import { Bell, Bot, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/appStore';

const ROLE_COLORS: Record<string, string> = {
  treasury_manager: 'bg-[#207679]/10 text-[#195a5c]',
  accountant: 'bg-[#207679]/10 text-[#207679]',
  auditor: 'bg-gray-100 text-gray-700',
};

export function Topbar({ title }: { title?: string }) {
  const { data: session } = useSession();
  const role = session?.user?.role ?? 'auditor';
  const { agentPanelOpen, toggleAgentPanel } = useAppStore();

  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6 shrink-0">
      <div>
        {title && <h1 className="text-lg font-semibold text-gray-900">{title}</h1>}
      </div>

      <div className="flex items-center gap-4">
        {/* Role badge */}
        <span
          className={cn(
            'text-xs font-medium px-2.5 py-1 rounded-full',
            ROLE_COLORS[role] ?? ROLE_COLORS.auditor
          )}
        >
          {role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
        </span>

        {/* Vantor AI toggle */}
        <button
          onClick={toggleAgentPanel}
          className={cn(
            'relative p-2 rounded-lg transition-colors',
            agentPanelOpen
              ? 'bg-[#207679]/10 text-[#207679]'
              : 'hover:bg-gray-100 text-gray-500'
          )}
          title="Toggle Vantor AI"
          aria-label="Toggle Vantor AI assistant"
        >
          <Bot className="h-5 w-5" />
        </button>

        {/* Notifications placeholder */}
        <button className="relative p-2 rounded-lg hover:bg-gray-100">
          <Bell className="h-5 w-5 text-gray-500" />
        </button>

        {/* User */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[#207679] text-white text-xs font-semibold">
            {session?.user?.name?.charAt(0).toUpperCase() ?? 'U'}
          </div>
          {session?.user?.email && (
            <span className="hidden sm:block text-sm text-gray-700">
              {session.user.email}
            </span>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => signOut({ callbackUrl: '/login' })}
          title="Sign out"
        >
          <LogOut className="h-5 w-5 text-gray-500" />
        </Button>
      </div>
    </header>
  );
}
