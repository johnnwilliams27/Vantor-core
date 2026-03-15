'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { capitalize, formatDateTime } from '@/lib/utils';
import { useYieldTransactions } from '@/hooks/useYield';
import { CardSpinner } from '@/components/ui/spinner';

const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: 'Aave V3',
  morpho: 'Morpho',
  kamino: 'Kamino',
  ondo: 'Ondo (USDY)',
};

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'destructive' | 'warning' | 'secondary'> = {
  completed: 'success',
  failed: 'destructive',
  pending: 'warning',
  processing: 'warning',
  cancelled: 'secondary',
};

function formatUsd(value: string | null): string {
  if (!value) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(parseFloat(value));
}

export function YieldTransactionTable() {
  const { data: transactions, isLoading } = useYieldTransactions();

  if (isLoading) {
    return <CardSpinner />;
  }

  if (!transactions?.length) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No yield transactions yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transaction History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Protocol</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
                <th className="text-left px-3 py-2 font-medium">Token</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Tx Hash</th>
                <th className="text-left px-3 py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <Badge variant={tx.tx_type === 'deposit' ? 'onramp' : 'offramp'}>
                      {capitalize(tx.tx_type)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{PROTOCOL_LABELS[tx.protocol] ?? tx.protocol}</td>
                  <td className="text-right px-3 py-2 font-medium">{formatUsd(tx.amount)}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{tx.underlying_token}</Badge></td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[tx.status] ?? 'secondary'}>
                      {capitalize(tx.status)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                    {tx.tx_hash ? `${tx.tx_hash.slice(0, 10)}…` : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(tx.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
