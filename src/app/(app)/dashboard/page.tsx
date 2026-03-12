import { UnifiedBalanceCard } from '@/components/treasury/UnifiedBalanceCard';
import { BalanceOverTime } from '@/components/charts/BalanceOverTime';
import { YieldEarned } from '@/components/charts/YieldEarned';
import { RecommendationsCard } from '@/components/charts/RecommendationsCard';
import { TokenDistribution } from '@/components/charts/TokenDistribution';
import { AppShell } from '@/components/layout/AppShell';

export const metadata = { title: 'Dashboard – Vantor' };

export default function DashboardPage() {
  return (
    <AppShell title="Dashboard">
      <div className="space-y-6">
        <UnifiedBalanceCard />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <YieldEarned />
          <RecommendationsCard />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BalanceOverTime />
          <TokenDistribution />
        </div>
      </div>
    </AppShell>
  );
}
