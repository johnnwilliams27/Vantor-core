'use client';
import { useState } from 'react';
import { ComplianceOverviewCard } from './ComplianceOverviewCard';
import { SanctionsScreeningPanel } from './SanctionsScreeningPanel';
import { KytAlertsTable } from './KytAlertsTable';
import { KytTransfersTable } from './KytTransfersTable';
import { TravelRulePanel } from './TravelRulePanel';
import { TabNav } from '@/components/ui/tab-nav';

type Tab = 'overview' | 'sanctions' | 'kyt' | 'travel-rule';

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'sanctions', label: 'Sanctions' },
  { value: 'kyt', label: 'Transaction Monitoring' },
  { value: 'travel-rule', label: 'Travel Rule' },
];

export function CompliancePageClient() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-6">
      <TabNav tabs={TABS} value={tab} onChange={setTab} />

      {/* Tab content */}
      {tab === 'overview' && <ComplianceOverviewCard />}

      {tab === 'sanctions' && <SanctionsScreeningPanel />}

      {tab === 'kyt' && (
        <div className="space-y-6">
          <KytAlertsTable />
          <KytTransfersTable />
        </div>
      )}

      {tab === 'travel-rule' && <TravelRulePanel />}
    </div>
  );
}
