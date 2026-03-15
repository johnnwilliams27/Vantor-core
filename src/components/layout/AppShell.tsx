'use client';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { PageSpinner } from '@/components/ui/spinner';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { TestModeBanner } from './TestModeBanner';
import { NavigationProgress } from './NavigationProgress';
import { AgentPanel } from '@/components/agent/AgentPanel';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status } = useSession();

  if (status === 'loading') {
    return <PageSpinner />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <NavigationProgress />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <TestModeBanner />
        <Topbar />
        <main className="flex-1 overflow-auto p-3 sm:p-6">
          <div key={pathname} className="fade-in">{children}</div>
        </main>
      </div>
      <AgentPanel />
    </div>
  );
}
