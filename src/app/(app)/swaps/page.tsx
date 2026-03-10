'use client';
import { AppShell } from '@/components/layout/AppShell';
import { SwapForm } from '@/components/swaps/SwapForm';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import type { Swap } from '@/types/database';
import { Loader2 } from 'lucide-react';

function SwapHistory() {
  const { data, isLoading } = useQuery<Swap[]>({
    queryKey: ['swaps'],
    queryFn: async () => {
      const res = await fetch('/api/swaps');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader><CardTitle>Swap History</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : data?.length ? (
              data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(s.from_amount)}</span>{' '}
                    <Badge variant="outline">{s.from_token}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold">{s.to_amount ? formatCurrency(s.to_amount) : '…'}</span>{' '}
                    <Badge variant="outline">{s.to_token}</Badge>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{capitalize(s.chain)}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={s.status === 'completed' ? 'success' as any : 'warning' as any}>
                      {capitalize(s.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(s.created_at)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No swaps yet.
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

export default function SwapsPage() {
  return (
    <AppShell title="Swaps">
      <div className="space-y-6">
        <SwapForm />
        <SwapHistory />
      </div>
    </AppShell>
  );
}
