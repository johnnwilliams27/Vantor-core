'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TrendingUp, Search } from 'lucide-react';
import { YieldPositionList } from './YieldPositionList';
import { YieldRatesTable } from './YieldRatesTable';
import { YieldTransactionTable } from './YieldTransactionTable';

type Tab = 'positions' | 'explore';

export function YieldPageClient() {
  const [tab, setTab] = useState<Tab>('positions');

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-2 border-b pb-3">
        {([
          { key: 'positions' as Tab, label: 'Positions', icon: TrendingUp },
          { key: 'explore' as Tab, label: 'Explore Protocols', icon: Search },
        ]).map(({ key, label, icon: Icon }) => (
          <Button
            key={key}
            variant={tab === key ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTab(key)}
            className="gap-2"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>

      {/* Content */}
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
