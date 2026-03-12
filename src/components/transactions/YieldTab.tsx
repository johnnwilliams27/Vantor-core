'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import type { YieldTransaction } from '@/types/database';
import { Loader2 } from 'lucide-react';

const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: 'Aave V3',
  morpho: 'Morpho',
  kamino: 'Kamino',
  ondo: 'Ondo (USDY)',
};

export function YieldTab() {
  const { data, isLoading } = useQuery<YieldTransaction[]>({
    queryKey: ['yield-transactions'],
    queryFn: async () => {
      const res = await fetch('/api/yield/transactions');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader><CardTitle>Yield Transactions</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : data?.length ? (
              data.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>
                    <Badge variant={tx.tx_type === 'deposit' ? 'onramp' : 'offramp'}>
                      {capitalize(tx.tx_type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{PROTOCOL_LABELS[tx.protocol] ?? tx.protocol}</TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(tx.amount)}</span>
                  </TableCell>
                  <TableCell><Badge variant="outline">{tx.underlying_token}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={tx.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(tx.chain)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      tx.status === 'completed' ? 'success' as any :
                      tx.status === 'failed' ? 'destructive' :
                      'warning' as any
                    }>
                      {capitalize(tx.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(tx.executed_at ?? tx.created_at)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No yield transactions yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}
