'use client';
import { useKytTransfers } from '@/hooks/useCompliance';
import { Badge } from '@/components/ui/badge';
import { capitalize } from '@/lib/utils';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

function riskColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score < 25) return 'text-green-600 dark:text-green-400';
  if (score < 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export function KytTransfersTable() {
  const { data: transfers, isLoading } = useKytTransfers();

  return (
    <div className="rounded-lg border bg-card">
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold">Monitored Transfers</h3>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
      ) : !transfers?.length ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No KYT transfers recorded yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Direction</th>
                <th className="px-4 py-2 font-medium">Amount (USD)</th>
                <th className="px-4 py-2 font-medium">Chain</th>
                <th className="px-4 py-2 font-medium">Risk Score</th>
                <th className="px-4 py-2 font-medium">Cluster</th>
                <th className="px-4 py-2 font-medium">Tx Hash</th>
                <th className="px-4 py-2 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
                const score = t.risk_score !== null ? parseFloat(t.risk_score) : null;
                return (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">
                      {t.direction === 'received' ? (
                        <Badge variant="onramp" className="gap-1">
                          <ArrowDownLeft className="h-3 w-3 shrink-0" />
                          Received
                        </Badge>
                      ) : (
                        <Badge variant="offramp" className="gap-1">
                          <ArrowUpRight className="h-3 w-3 shrink-0" />
                          Sent
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {t.asset_amount_usd || t.amount
                        ? Number(t.asset_amount_usd ?? t.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                        : '-'}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={t.chain === 'ethereum' ? 'ethereum' : 'solana'}>
                        {capitalize(t.chain)}
                      </Badge>
                    </td>
                    <td className={`px-4 py-2 font-medium ${riskColor(score)}`}>
                      {score !== null ? score.toFixed(1) : '-'}
                    </td>
                    <td className="px-4 py-2">{t.cluster_name ?? '-'}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {t.tx_hash ? `${t.tx_hash.slice(0, 10)}...` : '-'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(t.registered_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
