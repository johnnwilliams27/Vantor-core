'use client';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { NavigationProgress } from './NavigationProgress';
import { AgentPanel } from '@/components/agent/AgentPanel';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AppShell({ children, title }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <NavigationProgress />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Topbar title={title} />
        <main className="flex-1 overflow-auto p-6">
          <div key={pathname} className="fade-in">{children}</div>
        </main>
      </div>
      <AgentPanel />
    </div>
  );
}
