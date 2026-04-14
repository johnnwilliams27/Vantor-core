'use client';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { RecommendationList } from './RecommendationList';
import { TreasuryHealthCard } from './TreasuryHealthCard';
import { InsightFeed } from './InsightFeed';

const ReviewRecommendationModal = dynamic(
  () => import('./ReviewRecommendationModal').then((m) => m.ReviewRecommendationModal),
  { ssr: false }
);

export function TreasuryPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const reviewRecId = searchParams.get('reviewRec');

  const handleCloseReview = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('reviewRec');
    router.replace(url.pathname + url.search, { scroll: false });
  };

  return (
    <div className="space-y-4 md:space-y-5 lg:space-y-6">
      <TreasuryHealthCard />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <InsightFeed />
        <RecommendationList />
      </div>

      {reviewRecId && (
        <ReviewRecommendationModal
          recommendationId={reviewRecId}
          onClose={handleCloseReview}
        />
      )}
    </div>
  );
}
