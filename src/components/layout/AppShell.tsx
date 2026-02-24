'use client';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { AgentPanel } from '@/components/agent/AgentPanel';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AppShell({ children, title }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Topbar title={title} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <AgentPanel />
    </div>
  );
}
