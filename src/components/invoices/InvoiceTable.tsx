'use client';
import { useInvoices, useSyncInvoices } from '@/hooks/useInvoices';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import { RefreshCw, Loader2 } from 'lucide-react';
import type { InvoiceStatus } from '@/types/database';
import { useERPStore } from '@/store/erpStore';
import { useToast } from '@/components/ui/toast';

const STATUS_VARIANTS: Record<InvoiceStatus, 'default' | 'success' | 'warning' | 'destructive' | 'secondary'> = {
  unpaid: 'warning',
  paid: 'success',
  partially_paid: 'info' as any,
  overdue: 'destructive',
  cancelled: 'secondary',
};

export function InvoiceTable() {
  const { data: invoices, isLoading } = useInvoices();
  const { activeConfigId } = useERPStore();
  const { mutateAsync: syncInvoices, isPending: syncing } = useSyncInvoices(activeConfigId ?? '');
  const { toast } = useToast();

  const handleSync = async () => {
    if (!activeConfigId) {
      toast({ title: 'No ERP configured', description: 'Set up an ERP connection first', variant: 'destructive' });
      return;
    }
    try {
      const { data } = await syncInvoices();
      toast({ title: 'Sync complete', description: `${data?.synced ?? 0} invoices synced`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Sync failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Invoices</h2>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || !activeConfigId}>
          {syncing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing…</> : <><RefreshCw className="mr-2 h-4 w-4" />Sync from ERP</>}
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : invoices?.length ? (
              invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-sm">{inv.invoice_number}</TableCell>
                  <TableCell className="text-sm">{inv.vendor?.name ?? '—'}</TableCell>
                  <TableCell className="font-semibold">{formatCurrency(inv.amount)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{inv.token}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={inv.chain === 'ethereum' ? 'ethereum' : 'solana'}>
                      {capitalize(inv.chain)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[inv.status]}>
                      {capitalize(inv.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {inv.due_date ? formatDateTime(inv.due_date) : '—'}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-400 py-8">
                  No invoices. Sync from ERP or create manually.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
