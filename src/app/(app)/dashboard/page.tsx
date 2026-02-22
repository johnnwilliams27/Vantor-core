import { BalanceSummary } from '@/components/balances/BalanceSummary';
import { BalanceOverTime } from '@/components/charts/BalanceOverTime';
import { PaymentVolume } from '@/components/charts/PaymentVolume';
import { InvoiceAging } from '@/components/charts/InvoiceAging';
import { TokenDistribution } from '@/components/charts/TokenDistribution';
import { AppShell } from '@/components/layout/AppShell';

export const metadata = { title: 'Dashboard – Vantor' };

export default function DashboardPage() {
  return (
    <AppShell title="Dashboard">
      <div className="space-y-6">
        <BalanceSummary />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BalanceOverTime />
          <TokenDistribution />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PaymentVolume />
          <InvoiceAging />
        </div>
      </div>
    </AppShell>
  );
}
