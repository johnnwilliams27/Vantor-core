'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatDateTime, truncateAddress } from '@/lib/utils';
import type { Transaction } from '@/types/database';
import { Loader2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

export function OnChainTab() {
  const { data, isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
      const res = await fetch('/api/transactions?limit=100');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader><CardTitle>On-Chain Transactions</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dir</TableHead>
              <TableHead>TX Hash</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Chain</TableHead>
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
                    {tx.direction === 'inbound' ? (
                      <ArrowDownLeft className="h-4 w-4 text-green-500" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-red-500" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateAddress(tx.tx_hash, 8)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateAddress(tx.from_address, 6)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateAddress(tx.to_address, 6)}
                  </TableCell>
                  <TableCell>
                    {tx.amount ? (
                      <span className="font-semibold">{formatCurrency(tx.amount)}</span>
                    ) : '—'}
                    {tx.token && <Badge variant="outline" className="ml-1">{tx.token}</Badge>}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{tx.chain}</Badge></TableCell>
                  <TableCell className="text-sm text-gray-500">
                    {formatDateTime(tx.timestamp)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-400 py-8">
                  No transactions recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
