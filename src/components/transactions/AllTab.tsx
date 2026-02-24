'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import type { Payment, Swap, FiatTransaction, Transaction } from '@/types/database';

interface UnifiedRow {
  id: string;
  type: 'payment' | 'swap' | 'ramp' | 'onchain';
  date: string;
  amount: string;
  token: string;
  chain: string | null;
  status: string;
  description: string;
}

function mapPayments(payments: Payment[]): UnifiedRow[] {
  return payments.map((p) => ({
    id: `payment-${p.id}`,
    type: 'payment',
    date: p.created_at,
    amount: p.amount,
    token: p.token,
    chain: p.chain,
    status: p.status,
    description: p.direction === 'received'
      ? `Received from ${(p.from_address ?? p.to_address).slice(0, 8)}…`
      : `Sent to ${p.to_address.slice(0, 8)}…`,
  }));
}

function mapSwaps(swaps: Swap[]): UnifiedRow[] {
  return swaps.map((s) => ({
    id: `swap-${s.id}`,
    type: 'swap',
    date: s.created_at,
    amount: s.from_amount,
    token: s.from_token,
    chain: s.chain,
    status: s.status,
    description: `${s.from_token} → ${s.to_token}`,
  }));
}

function mapRamps(ramps: FiatTransaction[]): UnifiedRow[] {
  return ramps.map((r) => ({
    id: `ramp-${r.id}`,
    type: 'ramp',
    date: r.created_at,
    amount: r.crypto_amount,
    token: r.crypto_token,
    chain: null,
    status: r.status,
    description: r.direction === 'onramp' ? 'On-ramp (fiat→crypto)' : 'Off-ramp (crypto→fiat)',
  }));
}

function mapOnchain(txs: Transaction[]): UnifiedRow[] {
  return txs.map((t) => ({
    id: `onchain-${t.id}`,
    type: 'onchain',
    date: t.timestamp,
    amount: t.amount ?? '0',
    token: t.token ?? '—',
    chain: t.chain,
    status: t.status,
    description: t.direction === 'inbound'
      ? `From ${t.from_address.slice(0, 8)}…`
      : `To ${t.to_address.slice(0, 8)}…`,
  }));
}

const TYPE_BADGE: Record<UnifiedRow['type'], string> = {
  payment: 'bg-[#207679]/10 text-[#195a5c]',
  swap: 'bg-gray-100 text-gray-700',
  ramp: 'bg-amber-50 text-amber-700',
  onchain: 'bg-white border text-gray-600',
};

export function AllTab() {
  const { data, isLoading } = useQuery<UnifiedRow[]>({
    queryKey: ['unified-transactions'],
    queryFn: async () => {
      const [p, s, r, t] = await Promise.allSettled([
        fetch('/api/payments').then((res) => res.json()),
        fetch('/api/swaps').then((res) => res.json()),
        fetch('/api/ramps').then((res) => res.json()),
        fetch('/api/transactions?limit=100').then((res) => res.json()),
      ]);

      const payments: Payment[] = p.status === 'fulfilled' ? (p.value.data ?? []) : [];
      const swaps: Swap[] = s.status === 'fulfilled' ? (s.value.data ?? []) : [];
      const ramps: FiatTransaction[] = r.status === 'fulfilled' ? (r.value.data ?? []) : [];
      const onchain: Transaction[] = t.status === 'fulfilled' ? (t.value.data ?? []) : [];

      const all: UnifiedRow[] = [
        ...mapPayments(payments),
        ...mapSwaps(swaps),
        ...mapRamps(ramps),
        ...mapOnchain(onchain),
      ];

      return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    },
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader><CardTitle>All Activity</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
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
              data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold border ${TYPE_BADGE[row.type]}`}>
                      {row.type}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-700">{row.description}</TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(row.amount)}</span>{' '}
                    {row.token !== '—' && <Badge variant="outline">{row.token}</Badge>}
                  </TableCell>
                  <TableCell>
                    {row.chain ? <Badge variant="secondary">{row.chain}</Badge> : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      row.status === 'completed' ? 'success' as any :
                      row.status === 'failed' ? 'destructive' :
                      'warning' as any
                    }>
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                    {formatDateTime(row.date)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                  No activity yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
