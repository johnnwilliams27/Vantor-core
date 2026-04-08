'use client';
import { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useYieldPositions } from '@/hooks/useYield';
import { CardSpinner } from '@/components/ui/spinner';
import { ChevronDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { YieldPosition } from '@/types/database';

const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: 'Aave V3', morpho: 'Morpho', morpho_steakhouse: 'Morpho Steakhouse',
  kamino: 'Kamino', kamino_multiply: 'Kamino Multiply', ondo: 'Ondo (USDY)',
  sky: 'Sky sUSDS', ethena: 'Ethena sUSDe', maple: 'Maple', drift: 'Drift',
};

const PROTOCOL_LOGOS: Record<string, string> = {
  aave_v3: '/partners/Aave_idWRQ7YLO7_0.svg',
  morpho: '/partners/morpho-white.svg',
  morpho_steakhouse: '/partners/morpho-white.svg',
  kamino: '/partners/kamino-logo.svg',
  kamino_multiply: '/partners/kamino-logo.svg',
  ondo: '/partners/Ondo_Logo_0.svg',
  sky: '/partners/sky_logo.png',
  ethena: '/partners/ethena_logo.png',
  maple: '/partners/maple_logo.svg',
  drift: '/partners/drift_logo.svg',
};

function formatUsd(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(num);
}

function formatAPY(value: string | number | null): string {
  if (value === null || value === undefined) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  // apy_snapshot is stored as a percentage (e.g. 6.1 = 6.1%), not a decimal
  return `${num.toFixed(2)}%`;
}

function PositionCard({ pos }: { pos: YieldPosition }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {PROTOCOL_LOGOS[pos.protocol] && (
              <Image src={PROTOCOL_LOGOS[pos.protocol]} alt={pos.protocol} width={24} height={24} className="h-6 w-6 object-contain" unoptimized />
            )}
            {PROTOCOL_LABELS[pos.protocol] ?? pos.protocol}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={pos.chain === 'ethereum' ? 'ethereum' : 'solana'}>
              {pos.chain === 'ethereum' ? 'Ethereum' : 'Solana'}
            </Badge>
            <Badge variant="secondary">{pos.underlying_token}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Deposited</p>
            <p className="font-semibold mt-0.5">{formatUsd(pos.deposited_amount)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Current Value</p>
            <p className="font-semibold mt-0.5">{formatUsd(pos.current_value_usd)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Yield Earned</p>
            <p className="font-semibold text-green-600 mt-0.5">{formatUsd(pos.accrued_yield_usd)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">APY</p>
            <p className="font-semibold mt-0.5">{formatAPY(pos.apy_snapshot)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function YieldPositionsSummary() {
  const { data: positions, isLoading } = useYieldPositions();
  const [expanded, setExpanded] = useState(false);

  if (isLoading) return <CardSpinner />;
  if (!positions?.length) return null;

  const totalValue = positions.reduce((s, p) => s + parseFloat(p.current_value_usd), 0);
  const totalYield = positions.reduce((s, p) => s + parseFloat(p.accrued_yield_usd), 0);

  const visiblePositions = expanded ? positions : positions.slice(0, 2);
  const hasMore = positions.length > 2;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Yield Positions
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {formatUsd(totalValue)} deployed
          </span>
          <span className="text-green-600 font-medium">
            +{formatUsd(totalYield)} earned
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visiblePositions.map((pos) => (
          <PositionCard key={pos.id} pos={pos} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 mx-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
          {expanded ? 'Show less' : `Show all ${positions.length} positions`}
        </button>
      )}
    </div>
  );
}
