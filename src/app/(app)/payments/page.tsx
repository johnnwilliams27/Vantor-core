'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SendPaymentForm } from '@/components/payments/SendPaymentForm';
import { SchedulePaymentForm } from '@/components/payments/SchedulePaymentForm';
import { useFiatPayments } from '@/hooks/useFiatPayments';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { FiatPayment } from '@/types/fiat-payments';
import { CardSpinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const STATUS_COLORS: Record<string, string> = {
  pending: 'warning',
  processing: 'info',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'secondary',
};

function getPaymentStatus(p: FiatPayment): string {
  if (p.scheduled_for && !p.executed_at) return 'Scheduled';
  if (p.status === 'pending' && p.executed_at) return 'Pending';
  return capitalize(p.status);
}

function getStatusVariant(p: FiatPayment): string {
  if (p.scheduled_for && !p.executed_at) return 'info';
  if (p.status === 'pending' && p.executed_at) return 'warning';
  return STATUS_COLORS[p.status] ?? 'secondary';
}

function formatFromBank(p: FiatPayment): string {
  const ba = p.from_bank_account;
  if (!ba) return '—';
  if (ba.nickname) return ba.nickname;
  return `${ba.institution_name}${ba.last4 ? ` ****${ba.last4}` : ''}`;
}

const PAYMENT_FILTER_CONFIG = {
  searchFields: [
    'to_bank_name' as const,
    'to_account_holder' as const,
    'memo' as const,
    'currency' as const,
  ],
  dropdowns: [
    { key: 'status', accessor: (item: FiatPayment) => getPaymentStatus(item) },
    { key: 'currency', accessor: (item: FiatPayment) => item.currency },
  ],
  dateField: (item: FiatPayment) => item.created_at,
};

const EXPORT_COLUMNS: ExportColumn<FiatPayment>[] = [
  { header: 'From', accessor: (r) => formatFromBank(r) },
  { header: 'To', accessor: (r) => `${r.to_account_holder} (${r.to_bank_name})` },
  { header: 'Amount', accessor: (r) => formatCurrency(r.amount) },
  { header: 'Currency', accessor: (r) => r.currency },
  { header: 'Status', accessor: (r) => getPaymentStatus(r) },
  { header: 'Scheduled', accessor: (r) => r.scheduled_for ? formatDateTime(r.scheduled_for) : '—' },
  { header: 'Settled', accessor: (r) => r.settled_at ? formatDateTime(r.settled_at) : '—' },
  { header: 'Date', accessor: (r) => formatDateTime(r.created_at) },
];

function PaymentHistory() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [detailPayment, setDetailPayment] = useState<FiatPayment | null>(null);

  const { data, isLoading } = useFiatPayments();

  const filter = useTableFilter(data, PAYMENT_FILTER_CONFIG);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      const res = await fetch(`/api/payments/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Cancel failed');
      }
      toast({ title: 'Payment cancelled', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['fiat-payments'] });
    } catch (err) {
      toast({ title: 'Cancel failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setCancellingId(null);
      setConfirmCancelId(null);
    }
  };

  const canCancel = (p: FiatPayment) => !!(p.scheduled_for && !p.executed_at);

  return (
    <>
      <Card>
        <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <FilterBar
            search={filter.search}
            onSearchChange={filter.setSearch}
            searchPlaceholder="Search payments..."
            dropdowns={[
              { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
              { key: 'currency', label: 'Currency', options: filter.dropdownOptions.currency ?? [] },
            ]}
            filters={filter.filters}
            onFilterChange={filter.setFilter}
            showDateRange
            dateFrom={filter.dateFrom}
            dateTo={filter.dateTo}
            onDateFromChange={filter.setDateFrom}
            onDateToChange={filter.setDateTo}
            resultCount={filter.filteredData.length}
            totalCount={filter.totalCount}
            activeFilterCount={filter.activeFilterCount}
            onClear={filter.clearAll}
            onExportCsv={() => exportCsv('payments', EXPORT_COLUMNS, filter.filteredData)}
            onExportPdf={() => exportPdf('payments', 'Payment History', EXPORT_COLUMNS, filter.filteredData, 'landscape')}
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Settled</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <CardSpinner />
                    </TableCell>
                  </TableRow>
                ) : filter.pagedData.length ? (
                  filter.pagedData.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailPayment(p)}
                    >
                      <TableCell className="text-sm">{formatFromBank(p)}</TableCell>
                      <TableCell className="text-sm">
                        {p.to_account_holder} <span className="text-muted-foreground">({p.to_bank_name})</span>
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{formatCurrency(p.amount)}</TableCell>
                      <TableCell><Badge variant="outline">{p.currency}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(p) as any}>{getPaymentStatus(p)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {p.scheduled_for ? formatDateTime(p.scheduled_for) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {p.settled_at ? formatDateTime(p.settled_at) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateTime(p.created_at)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {canCancel(p) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-3 text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400"
                            onClick={() => setConfirmCancelId(p.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      {filter.activeFilterCount > 0 ? 'No matching payments.' : 'No payments yet.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <TablePagination
            page={filter.page}
            totalPages={filter.totalPages}
            pageSize={filter.pageSize}
            filteredCount={filter.filteredCount}
            onPageChange={filter.setPage}
            onPageSizeChange={filter.setPageSize}
          />
        </CardContent>
      </Card>

      {/* Cancel confirmation modal */}
      {(() => {
        const cancelPayment = data?.find((p) => p.id === confirmCancelId);
        return (
          <Dialog open={!!confirmCancelId} onOpenChange={(o) => !o && setConfirmCancelId(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Cancel Payment</DialogTitle>
              </DialogHeader>
              {cancelPayment && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Are you sure you want to cancel this scheduled payment?
                  </p>
                  <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Amount</span>
                      <span className="font-medium">{formatCurrency(cancelPayment.amount)} {cancelPayment.currency}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">To</span>
                      <span>{cancelPayment.to_account_holder} ({cancelPayment.to_bank_name})</span>
                    </div>
                    {cancelPayment.scheduled_for && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Scheduled</span>
                        <span>{formatDateTime(cancelPayment.scheduled_for)}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
                </div>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setConfirmCancelId(null)}>
                  Go Back
                </Button>
                <Button
                  variant="outline"
                  className="text-red-600 border-red-300 hover:bg-red-50"
                  onClick={() => confirmCancelId && handleCancel(confirmCancelId)}
                  disabled={!!cancellingId}
                >
                  {cancellingId ? 'Cancelling…' : 'Confirm Cancel'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Detail modal */}
      <Dialog open={!!detailPayment} onOpenChange={(o) => !o && setDetailPayment(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Payment Details</DialogTitle>
          </DialogHeader>
          {detailPayment && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-muted/40 rounded-md p-3">
                <span className="text-muted-foreground">From Bank</span>
                <span className="font-medium text-right">{formatFromBank(detailPayment)}</span>

                <span className="text-muted-foreground">To Bank</span>
                <span className="font-medium text-right">{detailPayment.to_bank_name}</span>

                <span className="text-muted-foreground">Account Holder</span>
                <span className="font-medium text-right">{detailPayment.to_account_holder}</span>

                <span className="text-muted-foreground">Account Number</span>
                <span className="font-mono text-right">****{detailPayment.to_account_number.slice(-4)}</span>

                <span className="text-muted-foreground">Routing Number</span>
                <span className="font-mono text-right">{detailPayment.to_routing_number}</span>

                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold text-right">{formatCurrency(detailPayment.amount)} {detailPayment.currency}</span>

                <span className="text-muted-foreground">Status</span>
                <span className="text-right">
                  <Badge variant={getStatusVariant(detailPayment) as any}>{getPaymentStatus(detailPayment)}</Badge>
                </span>

                {detailPayment.scheduled_for && (
                  <>
                    <span className="text-muted-foreground">Scheduled For</span>
                    <span className="text-right">{formatDateTime(detailPayment.scheduled_for)}</span>
                  </>
                )}

                {detailPayment.executed_at && (
                  <>
                    <span className="text-muted-foreground">Executed At</span>
                    <span className="text-right">{formatDateTime(detailPayment.executed_at)}</span>
                  </>
                )}

                {detailPayment.estimated_settlement && (
                  <>
                    <span className="text-muted-foreground">Est. Settlement</span>
                    <span className="text-right">{formatDateTime(detailPayment.estimated_settlement)}</span>
                  </>
                )}

                {detailPayment.settled_at && (
                  <>
                    <span className="text-muted-foreground">Settled At</span>
                    <span className="text-right">{formatDateTime(detailPayment.settled_at)}</span>
                  </>
                )}

                {detailPayment.memo && (
                  <>
                    <span className="text-muted-foreground">Memo</span>
                    <span className="text-right">{detailPayment.memo}</span>
                  </>
                )}

                {detailPayment.invoice_id && (
                  <>
                    <span className="text-muted-foreground">Invoice</span>
                    <span className="font-mono text-right text-xs">{detailPayment.invoice_id}</span>
                  </>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailPayment(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PaymentsPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SendPaymentForm />
        <SchedulePaymentForm />
      </div>
      <PaymentHistory />
    </div>
  );
}
