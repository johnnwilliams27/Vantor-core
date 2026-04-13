'use client';
import { useKytTransfers } from '@/hooks/useCompliance';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TruncatedAddress } from '@/components/ui/truncated-address';
import { ChainBadge } from '@/components/ui/icons/chain-logos';
import { capitalize, formatDateTime } from '@/lib/utils';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { TableRowsSkeleton } from '@/components/ui/operations-skeletons';

function riskTone(score: number | null): 'muted' | 'active' | 'pending' | 'failed' {
  if (score === null) return 'muted';
  if (score < 25) return 'active';
  if (score < 50) return 'pending';
  return 'failed';
}

const RISK_TEXT: Record<'muted' | 'active' | 'pending' | 'failed', string> = {
  muted: 'text-muted-foreground',
  active: 'text-teal-400',
  pending: 'text-amber-400',
  failed: 'text-red-400',
};

export function KytTransfersTable() {
  const { data: transfers, isLoading } = useKytTransfers();

  return (
    <div className="rounded-lg border bg-card">
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold">Monitored Transfers</h3>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Direction</TableHead>
              <TableHead>Amount (USD)</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Risk Score</TableHead>
              <TableHead>Cluster</TableHead>
              <TableHead>Tx Hash</TableHead>
              <TableHead>Registered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRowsSkeleton columns={7} rows={4} />
            ) : !transfers?.length ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  No KYT transfers recorded yet
                </TableCell>
              </TableRow>
            ) : (
              transfers.map((t) => {
                const score = t.risk_score !== null ? parseFloat(t.risk_score) : null;
                const tone = riskTone(score);
                return (
                  <TableRow key={t.id}>
                    <TableCell>
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
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {t.asset_amount_usd || t.amount
                        ? Number(t.asset_amount_usd ?? t.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <ChainBadge chain={t.chain} />
                    </TableCell>
                    <TableCell className={`font-medium tabular-nums ${RISK_TEXT[tone]}`}>
                      {score !== null ? score.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell>{t.cluster_name ?? '—'}</TableCell>
                    <TableCell>
                      {t.tx_hash ? <TruncatedAddress address={t.tx_hash} chars={6} /> : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDateTime(t.registered_at)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
