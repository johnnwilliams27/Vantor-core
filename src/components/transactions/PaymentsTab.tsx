'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatDateTime, truncateAddress, capitalize } from '@/lib/utils';
import type { Payment } from '@/types/database';
import { Loader2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

function DirectionCell({ payment }: { payment: Payment }) {
  if (payment.direction === 'received') {
    return (
      <div className="flex items-center gap-1.5 text-green-700">
        <ArrowDownLeft className="h-4 w-4 shrink-0" />
        <span className="text-xs font-semibold">Received</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-red-600">
      <ArrowUpRight className="h-4 w-4 shrink-0" />
      <span className="text-xs font-semibold">Sent</span>
    </div>
  );
}

function CounterpartyCell({ payment }: { payment: Payment }) {
  if (payment.direction === 'received') {
    const addr = payment.from_address ?? payment.from_wallet?.address ?? '—';
    return (
      <div>
        <div className="text-xs text-gray-400 mb-0.5">From</div>
        <span className="font-mono text-xs">{addr === '—' ? '—' : truncateAddress(addr, 8)}</span>
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs text-gray-400 mb-0.5">To</div>
      <span className="font-mono text-xs">{truncateAddress(payment.to_address, 8)}</span>
    </div>
  );
}

export function PaymentsTab() {
  const { data, isLoading } = useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: async () => {
      const res = await fetch('/api/payments');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Direction</TableHead>
              <TableHead>Counterparty</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : data?.length ? (
              data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><DirectionCell payment={p} /></TableCell>
                  <TableCell><CounterpartyCell payment={p} /></TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(p.amount)}</span>{' '}
                    <Badge variant="outline">{p.token}</Badge>
                  </TableCell>
                  <TableCell><Badge variant={p.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(p.chain)}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={
                      p.status === 'completed' ? 'success' as any :
                      p.status === 'failed' ? 'destructive' :
                      'warning' as any
                    }>
                      {capitalize(p.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(p.created_at)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No payments yet.
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
