'use client';
import { AppShell } from '@/components/layout/AppShell';
import { SendPaymentForm } from '@/components/payments/SendPaymentForm';
import { SchedulePaymentForm } from '@/components/payments/SchedulePaymentForm';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatDateTime, truncateAddress, capitalize } from '@/lib/utils';
import type { Payment } from '@/types/database';
import { Loader2 } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'warning',
  processing: 'info',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'secondary',
};

function PaymentList() {
  const { data, isLoading } = useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: async () => {
      const res = await fetch('/api/payments');
      if (!res.ok) throw new Error('Failed to load');
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>To</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>ERP</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : data?.length ? (
              data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-sm">{truncateAddress(p.to_address, 6)}</TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(p.amount)}</span>
                  </TableCell>
                  <TableCell><Badge variant="outline">{p.token}</Badge></TableCell>
                  <TableCell><Badge variant={p.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(p.chain)}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLORS[p.status] as any}>{capitalize(p.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.erp_config ? (
                      <span title={p.erp_config.label}>
                        {p.erp_config.provider.toUpperCase()}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {p.scheduled_for ? formatDateTime(p.scheduled_for) : 'Immediate'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(p.created_at)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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

export default function PaymentsPage() {
  return (
    <AppShell title="Payments">
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SendPaymentForm />
          <SchedulePaymentForm />
        </div>
        <PaymentList />
      </div>
    </AppShell>
  );
}
