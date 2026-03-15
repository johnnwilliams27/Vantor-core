'use client';
import { useState } from 'react';
import { UnifiedBalanceCard } from './UnifiedBalanceCard';
import { TreasuryRulesForm } from './TreasuryRulesForm';
import { ObligationsPanel } from './ObligationsPanel';
import { RecommendationList } from './RecommendationList';
import { ForecastingPageClient } from './ForecastingPageClient';
import { TabNav } from '@/components/ui/tab-nav';

type Tab = 'overview' | 'recommendations' | 'forecasting';

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'recommendations', label: 'AI Recommendations' },
  { value: 'forecasting', label: 'Forecasting' },
];

export function TreasuryPageClient() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-6">
      <TabNav tabs={TABS} value={tab} onChange={setTab} />

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <UnifiedBalanceCard />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TreasuryRulesForm />
            <ObligationsPanel />
          </div>
        </div>
      )}

      {tab === 'recommendations' && <RecommendationList />}

      {tab === 'forecasting' && <ForecastingPageClient />}
    </div>
  );
}
