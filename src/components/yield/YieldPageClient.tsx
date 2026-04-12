'use client';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { TabNav } from '@/components/ui/tab-nav';
import { YieldPositionList } from './YieldPositionList';
import { YieldRatesTable } from './YieldRatesTable';
import { YieldTransactionTable } from './YieldTransactionTable';

type Tab = 'positions' | 'explore';

const TABS: { value: Tab; label: string }[] = [
  { value: 'positions', label: 'Positions' },
  { value: 'explore', label: 'Explore Protocols' },
];

export function YieldPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get('tab') as Tab) || 'positions';
  const [tab, setTab] = useState<Tab>(initialTab);

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    const url = new URL(window.location.href);
    if (newTab === 'positions') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', newTab);
    }
    router.replace(url.pathname + url.search, { scroll: false });
  };

  return (
    <div className="space-y-4 md:space-y-5 lg:space-y-6">
      <TabNav tabs={TABS} value={tab} onChange={handleTabChange} />

      {tab === 'positions' && (
        <div className="space-y-4 md:space-y-5 lg:space-y-6">
          <YieldPositionList />
          <YieldTransactionTable />
        </div>
      )}
      {tab === 'explore' && <YieldRatesTable />}
    </div>
  );
}
