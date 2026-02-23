'use client';
import { UnifiedBalanceCard } from './UnifiedBalanceCard';
import { TreasuryRulesForm } from './TreasuryRulesForm';
import { ObligationsPanel } from './ObligationsPanel';
import { RecommendationList } from './RecommendationList';

export function TreasuryPageClient() {
  return (
    <div className="space-y-6">
      {/* Unified balance overview */}
      <UnifiedBalanceCard />

      {/* Rules + Obligations side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TreasuryRulesForm />
        <ObligationsPanel />
      </div>

      {/* Recommendation list */}
      <RecommendationList />
    </div>
  );
}
