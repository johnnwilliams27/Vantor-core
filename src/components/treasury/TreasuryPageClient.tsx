'use client';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { TreasuryRulesForm } from './TreasuryRulesForm';
import { RecommendationList } from './RecommendationList';
import { ForecastingPageClient } from './ForecastingPageClient';
import { TreasuryHealthCard } from './TreasuryHealthCard';
import { YieldPositionsSummary } from './YieldPositionsSummary';
import { TabNav } from '@/components/ui/tab-nav';
import { ReviewRecommendationModal } from './ReviewRecommendationModal';

type Tab = 'overview' | 'rules' | 'forecasting';

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'rules', label: 'Treasury Rules' },
  { value: 'forecasting', label: 'Forecasting' },
];

export function TreasuryPageClient() {
  const [tab, setTab] = useState<Tab>('overview');
  const searchParams = useSearchParams();
  const router = useRouter();
  const reviewRecId = searchParams.get('reviewRec');

  const handleCloseReview = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('reviewRec');
    router.replace(url.pathname + url.search, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <TabNav tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-6">
          <TreasuryHealthCard />
          <YieldPositionsSummary />
          <RecommendationList />
        </div>
      )}

      {tab === 'rules' && <TreasuryRulesForm />}

      {tab === 'forecasting' && <ForecastingPageClient />}

      {reviewRecId && (
        <ReviewRecommendationModal
          recommendationId={reviewRecId}
          onClose={handleCloseReview}
        />
      )}
    </div>
  );
}
