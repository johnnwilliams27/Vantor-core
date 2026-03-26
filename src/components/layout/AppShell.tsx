'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { PageSpinner } from '@/components/ui/spinner';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { TestModeBanner } from './TestModeBanner';
import { NavigationProgress } from './NavigationProgress';
import { AgentPanel } from '@/components/agent/AgentPanel';
import { isPaidTier } from '@/lib/billing/tiers';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (!session?.user) return;
    const tier = session.user.subscription_tier;
    const kycStatus = session.user.kyc_status;
    if (isPaidTier(tier) && kycStatus !== 'completed' && pathname !== '/kyc-required') {
      router.replace('/kyc-required');
    }
  }, [session, pathname, router]);

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
