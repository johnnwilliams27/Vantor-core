'use client';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, capitalize } from '@/lib/utils';
import type { FiatTransaction } from '@/types/database';
import { ArrowDownLeft, ArrowUpRight, History } from 'lucide-react';

async function fetchFiatTransactions(): Promise<FiatTransaction[]> {
  const res = await fetch('/api/ramps');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data;
}

function StatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
    completed: 'success',
    pending: 'warning',
    payment_submitted: 'warning',
    failed: 'destructive',
  };
  return <Badge variant={variantMap[status] ?? 'secondary'}>{capitalize(status)}</Badge>;
}

function DirectionBadge({ direction }: { direction: 'onramp' | 'offramp' }) {
  if (direction === 'onramp') {
    return (
      <span className="inline-flex items-center gap-1 text-green-700 text-xs font-semibold whitespace-nowrap">
        <ArrowDownLeft className="h-3 w-3 shrink-0" />
        On-ramp
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-orange-700 text-xs font-semibold whitespace-nowrap">
      <ArrowUpRight className="h-3 w-3 shrink-0" />
      Off-ramp
    </span>
  );
}

export function FiatTransactionTable() {
  const { data: txs, isLoading, error } = useQuery({
    queryKey: ['fiat-transactions'],
    queryFn: fetchFiatTransactions,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Ramp History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-gray-400 py-4">Loading…</div>
        ) : error ? (
          <div className="text-sm text-red-500 py-4">{(error as Error).message}</div>
        ) : !txs?.length ? (
          <div className="text-sm text-gray-400 text-center py-8">
            No ramp transactions yet. Use the form above to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500 text-xs">
                  <th className="text-left py-2 pr-4">Direction</th>
                  <th className="text-right py-2 pr-4">Crypto</th>
                  <th className="text-right py-2 pr-4">Fiat</th>
                  <th className="text-right py-2 pr-4">Rate</th>
                  <th className="text-right py-2 pr-4">Fee</th>
                  <th className="text-left py-2 pr-4">Bank</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((tx) => (
                  <tr key={tx.id} className="border-b last:border-0 hover:bg-gray-50/50">
                    <td className="py-2 pr-4">
                      <DirectionBadge direction={tx.direction} />
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {parseFloat(tx.crypto_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {tx.crypto_token}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {parseFloat(tx.fiat_amount).toLocaleString(undefined, { style: 'currency', currency: tx.fiat_currency })}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-500">
                      {tx.exchange_rate ? parseFloat(tx.exchange_rate).toFixed(4) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-500">
                      {tx.fee_amount
                        ? parseFloat(tx.fee_amount).toLocaleString(undefined, { style: 'currency', currency: tx.fiat_currency })
                        : '—'}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">
                      {tx.bank_account
                        ? `${tx.bank_account.institution_name}${tx.bank_account.last4 ? ` ****${tx.bank_account.last4}` : ''}`
                        : '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={tx.status} />
                    </td>
                    <td className="py-2 text-gray-400 whitespace-nowrap">
                      {formatDate(tx.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
