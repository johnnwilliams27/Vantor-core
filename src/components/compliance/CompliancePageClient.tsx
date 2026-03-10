'use client';
import { useState } from 'react';
import { ComplianceOverviewCard } from './ComplianceOverviewCard';
import { SanctionsScreeningPanel } from './SanctionsScreeningPanel';
import { KytAlertsTable } from './KytAlertsTable';
import { KytTransfersTable } from './KytTransfersTable';
import { TravelRulePanel } from './TravelRulePanel';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Eye, Plane } from 'lucide-react';

type ActiveTab = 'sanctions' | 'kyt' | 'travel-rule';

export function CompliancePageClient() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('sanctions');

  return (
    <div className="space-y-6">
      <ComplianceOverviewCard />

      {/* Tab switcher */}
      <div className="flex items-center gap-2 border-b pb-2">
        <Button
          variant={activeTab === 'sanctions' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('sanctions')}
          className="flex items-center gap-1.5"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Sanctions
        </Button>
        <Button
          variant={activeTab === 'kyt' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('kyt')}
          className="flex items-center gap-1.5"
        >
          <Eye className="h-3.5 w-3.5" />
          Transaction Monitoring
        </Button>
        <Button
          variant={activeTab === 'travel-rule' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('travel-rule')}
          className="flex items-center gap-1.5"
        >
          <Plane className="h-3.5 w-3.5" />
          Travel Rule
        </Button>
      </div>

      {/* Tab content */}
      {activeTab === 'sanctions' && <SanctionsScreeningPanel />}

      {activeTab === 'kyt' && (
        <div className="space-y-6">
          <KytAlertsTable />
          <KytTransfersTable />
        </div>
      )}

      {activeTab === 'travel-rule' && <TravelRulePanel />}
    </div>
  );
}
