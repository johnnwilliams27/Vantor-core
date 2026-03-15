'use client';
import { useState } from 'react';
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
  const [tab, setTab] = useState<Tab>('positions');

  return (
    <div className="space-y-6">
      <TabNav tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'positions' && (
        <div className="space-y-6">
          <YieldPositionList />
          <YieldTransactionTable />
        </div>
      )}
      {tab === 'explore' && <YieldRatesTable />}
    </div>
  );
}
