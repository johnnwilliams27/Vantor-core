'use client';
import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { AllTab } from '@/components/transactions/AllTab';
import { PaymentsTab } from '@/components/transactions/PaymentsTab';
import { SwapsTab } from '@/components/transactions/SwapsTab';
import { RampsTab } from '@/components/transactions/RampsTab';
import { OnChainTab } from '@/components/transactions/OnChainTab';
import { YieldTab } from '@/components/transactions/YieldTab';
import { useSession } from 'next-auth/react';
import { hasRole } from '@/lib/auth/rbac';
import type { UserRole } from '@/types/database';

type ActiveTab = 'all' | 'payments' | 'swaps' | 'ramps' | 'yield' | 'onchain';

const TABS: { id: ActiveTab; label: string; minRole?: UserRole }[] = [
  { id: 'all', label: 'All' },
  { id: 'payments', label: 'Payments', minRole: 'treasury_manager' },
  { id: 'swaps', label: 'Swaps', minRole: 'treasury_manager' },
  { id: 'ramps', label: 'Ramps', minRole: 'treasury_manager' },
  { id: 'yield', label: 'Yield', minRole: 'treasury_manager' },
  { id: 'onchain', label: 'On-Chain' },
];

export default function TransactionsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('all');
  const { data: session } = useSession();
  const userRole = (session?.user?.role ?? 'auditor') as UserRole;

  const visibleTabs = TABS.filter((t) => !t.minRole || hasRole(userRole, t.minRole));

  return (
    <AppShell title="Transactions">
      <div className="space-y-4">
        {/* Tab bar */}
        <div className="flex gap-1 border-b pb-0">
          {visibleTabs.map((tab) => (
            <Button
              key={tab.id}
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? 'border-b-2 border-[#207679] text-[#207679] rounded-none pb-2 font-semibold'
                  : 'text-gray-500 hover:text-gray-700 rounded-none pb-2'
              }
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Tab content — conditional render prevents unauthorized fetches */}
        {activeTab === 'all'      && <AllTab />}
        {activeTab === 'payments' && <PaymentsTab />}
        {activeTab === 'swaps'    && <SwapsTab />}
        {activeTab === 'ramps'    && <RampsTab />}
        {activeTab === 'yield'    && <YieldTab />}
        {activeTab === 'onchain'  && <OnChainTab />}
      </div>
    </AppShell>
  );
}
