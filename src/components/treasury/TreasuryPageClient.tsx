'use client';
import { useState } from 'react';
import { TreasuryRulesForm } from './TreasuryRulesForm';
import { RecommendationList } from './RecommendationList';
import { ForecastingPageClient } from './ForecastingPageClient';
import { YieldPositionsSummary } from './YieldPositionsSummary';
import { TabNav } from '@/components/ui/tab-nav';

type Tab = 'overview' | 'rules' | 'forecasting';

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'rules', label: 'Treasury Rules' },
  { value: 'forecasting', label: 'Forecasting' },
];

export function TreasuryPageClient() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-6">
      <TabNav tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-6">
          <YieldPositionsSummary />
          <RecommendationList />
        </div>
      )}

      {tab === 'rules' && <TreasuryRulesForm />}

      {tab === 'forecasting' && <ForecastingPageClient />}
    </div>
  );
}
