'use client';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { TreasuryRulesForm } from './TreasuryRulesForm';
import { RecommendationList } from './RecommendationList';
import { ForecastingPageClient } from './ForecastingPageClient';
import { TreasuryHealthCard } from './TreasuryHealthCard';
import { InsightFeed } from './InsightFeed';
import { TabNav } from '@/components/ui/tab-nav';

const ReviewRecommendationModal = dynamic(
  () => import('./ReviewRecommendationModal').then((m) => m.ReviewRecommendationModal),
  { ssr: false }
);

type Tab = 'overview' | 'rules' | 'forecasting';

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'rules', label: 'Treasury Rules' },
  { value: 'forecasting', label: 'Forecasting' },
];

export function TreasuryPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);
  const reviewRecId = searchParams.get('reviewRec');

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    const url = new URL(window.location.href);
    if (newTab === 'overview') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', newTab);
    }
    router.replace(url.pathname + url.search, { scroll: false });
  };

  const handleCloseReview = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('reviewRec');
    router.replace(url.pathname + url.search, { scroll: false });
  };

  return (
    <div className="space-y-4 md:space-y-5 lg:space-y-6">
      <TabNav tabs={TABS} value={tab} onChange={handleTabChange} />

      {tab === 'overview' && (
        <div className="space-y-4 md:space-y-5 lg:space-y-6">
          <TreasuryHealthCard />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
            <InsightFeed />
            <RecommendationList />
          </div>
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
