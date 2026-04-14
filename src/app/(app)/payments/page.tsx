'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SendPaymentForm } from '@/components/payments/SendPaymentForm';
import { SchedulePaymentForm } from '@/components/payments/SchedulePaymentForm';
import { useFiatPayments } from '@/hooks/useFiatPayments';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { HoverTooltip } from '@/components/ui/hover-tooltip';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, formatRelativeOrDate, capitalize, sanitizeErrorMessage } from '@/lib/utils';
import { CancelScheduledDialog } from '@/components/ui/cancel-scheduled-dialog';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { FiatPayment } from '@/types/fiat-payments';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Check, Clock, XCircle, Building2 } from 'lucide-react';
import { ComingSoonPanel } from '@/components/ui/coming-soon-panel';
import { useAppStore } from '@/store/appStore';
import { useSession } from 'next-auth/react';

// Migrated to semantic badge variants (style guide Stage 3b).
const STATUS_COLORS: Record<string, string> = {
  pending: 'pending',
  processing: 'pending',
  completed: 'active',
  failed: 'failed',
  cancelled: 'inactive',
};

function getPaymentStatus(p: FiatPayment): string {
  if (p.scheduled_for && !p.executed_at) return 'Scheduled';
  if (p.status === 'pending' && p.executed_at) return 'Pending';
  return capitalize(p.status);
}

function getStatusVariant(p: FiatPayment): string {
  // Scheduled ops = informational (future action), in-flight pending = pending (amber).
  if (p.scheduled_for && !p.executed_at) return 'info-blue';
  if (p.status === 'pending' && p.executed_at) return 'pending';
  return STATUS_COLORS[p.status] ?? 'inactive';
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
  sortColumns: [
    { key: 'amount', accessor: (item: FiatPayment) => parseFloat(item.amount), type: 'number' as const },
    { key: 'date', accessor: (item: FiatPayment) => item.created_at, type: 'date' as const },
  ],
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
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [detailPayment, setDetailPayment] = useState<FiatPayment | null>(null);

  const { data, isLoading } = useFiatPayments();

  const filter = useTableFilter(data, PAYMENT_FILTER_CONFIG);

  const cancelPayment = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/payments/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Cancel failed');
      }
    },
    onSuccess: () => {
      toast({ title: 'Payment cancelled', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['fiat-payments'] });
      setConfirmCancelId(null);
    },
    onError: (err: Error) => {
      toast({ title: 'Cancel failed', description: sanitizeErrorMessage(err.message), variant: 'destructive' });
    },
  });

  const canCancel = (p: FiatPayment) => !!(p.scheduled_for && !p.executed_at);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
        <CardContent>
          <TableCardSkeleton columns={9} rows={5} />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card data-history-table>
        <CardHeader><CardTitle className="flex items-center gap-2">
            Payment History
            {filter.totalCount > 0 && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-white/[0.06] text-muted-foreground">
                {filter.totalCount}
              </span>
            )}
          </CardTitle></CardHeader>
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
          <div className="relative overflow-x-auto">
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-black/40 to-transparent lg:hidden z-10" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">From</TableHead>
                  <TableHead scope="col">To</TableHead>
                  <TableHead scope="col">
                    <button
                      type="button"
                      onClick={() => filter.toggleSort('amount')}
                      className="flex items-center gap-1 hover:text-white transition-colors group"
                      aria-sort={filter.sortKey === 'amount' ? (filter.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      Amount
                      <span className={`text-3xs ${filter.sortKey === 'amount' ? 'text-teal-400' : 'opacity-0 group-hover:opacity-40'}`}>
                        {filter.sortKey === 'amount' ? (filter.sortDir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead scope="col">Currency</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Scheduled</TableHead>
                  <TableHead scope="col">Settled</TableHead>
                  <TableHead scope="col">
                    <button
                      type="button"
                      onClick={() => filter.toggleSort('date')}
                      className="flex items-center gap-1 hover:text-white transition-colors group"
                      aria-sort={filter.sortKey === 'date' ? (filter.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      Date
                      <span className={`text-3xs ${filter.sortKey === 'date' ? 'text-teal-400' : 'opacity-0 group-hover:opacity-40'}`}>
                        {filter.sortKey === 'date' ? (filter.sortDir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead scope="col"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filter.pagedData.length ? (
                  filter.pagedData.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-white/[0.02] focus-within:bg-white/[0.02]"
                      tabIndex={0}
                      onClick={() => setDetailPayment(p)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailPayment(p); }}}
                      role="button"
                      aria-label={`View payment details for ${p.to_account_holder}`}
                    >
                      <TableCell className="text-sm">{formatFromBank(p)}</TableCell>
                      <TableCell className="text-sm">
                        {p.to_account_holder} <span className="text-muted-foreground">({p.to_bank_name})</span>
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{formatCurrency(p.amount)}</TableCell>
                      <TableCell><Badge variant="outline">{p.currency}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(p) as any}>
                          {getStatusVariant(p) === 'active' ? <Check className="h-3 w-3 mr-1" /> :
                           getStatusVariant(p) === 'failed' ? <XCircle className="h-3 w-3 mr-1" /> :
                           <Clock className="h-3 w-3 mr-1" />}
                          {getPaymentStatus(p)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {p.scheduled_for ? formatDateTime(p.scheduled_for) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {p.settled_at ? formatDateTime(p.settled_at) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        <HoverTooltip label={formatRelativeOrDate(p.created_at).full}>
                          <span>{formatRelativeOrDate(p.created_at).text}</span>
                        </HoverTooltip>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {canCancel(p) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 text-xs px-3 text-red-400 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/30"
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
                    <TableCell colSpan={9} className="text-center py-12">
                      {filter.activeFilterCount > 0 ? (
                        <span className="text-muted-foreground">No matching results.</span>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-muted-foreground">No payments yet.</p>
                          <p className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                            Create your first payments ↑
                          </p>
                        </div>
                      )}
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
        const cancelTarget = data?.find((p) => p.id === confirmCancelId);
        return (
          <CancelScheduledDialog
            open={!!confirmCancelId}
            onOpenChange={(o) => !o && setConfirmCancelId(null)}
            title="Cancel Payment"
            details={cancelTarget ? [
              { label: 'Amount', value: `${formatCurrency(cancelTarget.amount)} ${cancelTarget.currency}` },
              { label: 'To', value: `${cancelTarget.to_account_holder} (${cancelTarget.to_bank_name})` },
              ...(cancelTarget.scheduled_for ? [{ label: 'Scheduled', value: formatDateTime(cancelTarget.scheduled_for) }] : []),
            ] : []}
            onConfirm={() => confirmCancelId && cancelPayment.mutate(confirmCancelId)}
            isPending={cancelPayment.isPending}
          />
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 bg-white/[0.03] rounded-xl p-4">
                <span className="text-muted-foreground">From Bank</span>
                <span className="font-medium sm:text-right">{formatFromBank(detailPayment)}</span>

                <span className="text-muted-foreground">To Bank</span>
                <span className="font-medium sm:text-right">{detailPayment.to_bank_name}</span>

                <span className="text-muted-foreground">Account Holder</span>
                <span className="font-medium sm:text-right">{detailPayment.to_account_holder}</span>

                <span className="text-muted-foreground">Account Number</span>
                <span className="font-mono sm:text-right">****{detailPayment.to_account_number.slice(-4)}</span>

                <span className="text-muted-foreground">Routing Number</span>
                <span className="font-mono sm:text-right">{detailPayment.to_routing_number}</span>

                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold sm:text-right">{formatCurrency(detailPayment.amount)} {detailPayment.currency}</span>

                <span className="text-muted-foreground">Status</span>
                <span className="sm:text-right">
                  <Badge variant={getStatusVariant(detailPayment) as any}>{getPaymentStatus(detailPayment)}</Badge>
                </span>

                {detailPayment.scheduled_for && (
                  <>
                    <span className="text-muted-foreground">Scheduled For</span>
                    <span className="sm:text-right">{formatDateTime(detailPayment.scheduled_for)}</span>
                  </>
                )}

                {detailPayment.executed_at && (
                  <>
                    <span className="text-muted-foreground">Executed At</span>
                    <span className="sm:text-right">{formatDateTime(detailPayment.executed_at)}</span>
                  </>
                )}

                {detailPayment.estimated_settlement && (
                  <>
                    <span className="text-muted-foreground">Est. Settlement</span>
                    <span className="sm:text-right">{formatDateTime(detailPayment.estimated_settlement)}</span>
                  </>
                )}

                {detailPayment.settled_at && (
                  <>
                    <span className="text-muted-foreground">Settled At</span>
                    <span className="sm:text-right">{formatDateTime(detailPayment.settled_at)}</span>
                  </>
                )}

                {detailPayment.memo && (
                  <>
                    <span className="text-muted-foreground">Memo</span>
                    <span className="sm:text-right">{detailPayment.memo}</span>
                  </>
                )}

                {detailPayment.invoice_id && (
                  <>
                    <span className="text-muted-foreground">Invoice</span>
                    <span className="font-mono sm:text-right text-xs">{detailPayment.invoice_id}</span>
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
  const testMode = useAppStore((s) => s.testMode);
  const { data: session } = useSession();
  const tier = session?.user?.subscription_tier ?? 'lite';
  const showComingSoon = !(tier === 'lite' && testMode);

  if (showComingSoon) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Send Payment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ComingSoonPanel
              description="Bank-to-bank payments are being rewired through a new payment provider to support real ACH, wire, and international rails. We'll open this back up once the integration is complete."
              secondary="In the meantime, you can still view balances from your connected bank accounts and use on-chain transfers from your wallets."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SendPaymentForm />
        <SchedulePaymentForm />
      </div>
      <PaymentHistory />
    </div>
  );
}
