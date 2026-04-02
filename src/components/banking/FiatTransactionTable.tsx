'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { FiatTransaction } from '@/types/database';
import { ArrowDownLeft, ArrowUpRight, History } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';
import { useScheduledOperations, useCancelScheduledOperation } from '@/hooks/useScheduledOperations';
import type { RampParams } from '@/types/scheduled-operations';

async function fetchFiatTransactions(): Promise<FiatTransaction[]> {
  const res = await fetch('/api/ramps');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data;
}

interface UnifiedRampRow {
  id: string;
  direction: 'onramp' | 'offramp';
  crypto_amount: string;
  crypto_token: string;
  fiat_amount: string;
  fiat_currency: string;
  exchange_rate?: string | null;
  fee_amount?: string | null;
  bank_account?: FiatTransaction['bank_account'];
  status: string;
  created_at: string;
  scheduled_for: string | null;
  isScheduled: boolean;
  scheduledOpId?: string;
}

function StatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
    completed: 'success',
    pending: 'warning',
    payment_submitted: 'warning',
    failed: 'destructive',
    cancelled: 'destructive',
  };
  return <Badge variant={variantMap[status] ?? 'secondary'}>{capitalize(status)}</Badge>;
}

function DirectionBadge({ direction }: { direction: 'onramp' | 'offramp' }) {
  if (direction === 'onramp') {
    return (
      <Badge variant="onramp" className="gap-1">
        <ArrowDownLeft className="h-3 w-3 shrink-0" />
        On-ramp
      </Badge>
    );
  }
  return (
    <Badge variant="offramp" className="gap-1">
      <ArrowUpRight className="h-3 w-3 shrink-0" />
      Off-ramp
    </Badge>
  );
}

const RAMP_EXPORT_COLUMNS: ExportColumn<UnifiedRampRow>[] = [
  { header: 'Direction', accessor: (r) => capitalize(r.direction) },
  { header: 'Crypto Amount', accessor: (r) => parseFloat(r.crypto_amount).toLocaleString() },
  { header: 'Crypto Token', accessor: (r) => r.crypto_token },
  { header: 'Fiat Amount', accessor: (r) => parseFloat(r.fiat_amount).toLocaleString() },
  { header: 'Fiat Currency', accessor: (r) => r.fiat_currency },
  { header: 'Rate', accessor: (r) => r.exchange_rate ? parseFloat(r.exchange_rate).toFixed(4) : '' },
  { header: 'Fee', accessor: (r) => r.fee_amount ? parseFloat(r.fee_amount).toLocaleString() : '' },
  { header: 'Bank', accessor: (r) => r.bank_account?.institution_name ?? '' },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
  { header: 'Scheduled', accessor: (r) => r.scheduled_for ? formatDateTime(r.scheduled_for) : '' },
  { header: 'Date', accessor: (r) => formatDateTime(r.created_at) },
];

const RAMP_FILTER_CONFIG = {
  searchFields: [
    'crypto_token' as const,
    (item: UnifiedRampRow) => item.bank_account?.institution_name ?? '',
    (item: UnifiedRampRow) => item.bank_account?.nickname ?? '',
  ],
  dropdowns: [
    { key: 'direction', accessor: (item: UnifiedRampRow) => item.direction },
    { key: 'status', accessor: (item: UnifiedRampRow) => item.status },
  ],
  dateField: (item: UnifiedRampRow) => item.created_at,
};

export function FiatTransactionTable() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const cancelOp = useCancelScheduledOperation();
  const [confirmCancelOp, setConfirmCancelOp] = useState<UnifiedRampRow | null>(null);

  const { data: txs, isLoading: txsLoading } = useQuery({
    queryKey: ['fiat-transactions'],
    queryFn: fetchFiatTransactions,
  });

  const { data: scheduledOps } = useScheduledOperations({ type: 'ramp' });

  // Merge executed ramp transactions + scheduled ops into unified rows
  const allRows: UnifiedRampRow[] = [
    ...(txs ?? []).map((tx): UnifiedRampRow => ({
      id: tx.id,
      direction: tx.direction,
      crypto_amount: tx.crypto_amount,
      crypto_token: tx.crypto_token,
      fiat_amount: tx.fiat_amount,
      fiat_currency: tx.fiat_currency,
      exchange_rate: tx.exchange_rate,
      fee_amount: tx.fee_amount,
      bank_account: tx.bank_account,
      status: tx.status,
      created_at: tx.created_at,
      scheduled_for: null,
      isScheduled: false,
    })),
    ...(scheduledOps ?? [])
      .filter((op) => op.status !== 'completed') // completed ones will show as fiat transactions
      .map((op): UnifiedRampRow => {
        const p = op.params as RampParams;
        return {
          id: `sched-${op.id}`,
          direction: p.direction,
          crypto_amount: String(p.cryptoAmount),
          crypto_token: p.cryptoToken,
          fiat_amount: p.fiatAmount ? String(p.fiatAmount) : '0',
          fiat_currency: p.fiatCurrency,
          exchange_rate: null,
          fee_amount: null,
          bank_account: undefined,
          status: op.status === 'awaiting_authorization' ? 'awaiting approval' : op.status,
          created_at: op.created_at,
          scheduled_for: op.scheduled_for,
          isScheduled: true,
          scheduledOpId: op.id,
        };
      }),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const filter = useTableFilter(allRows, RAMP_FILTER_CONFIG);

  const handleCancel = async () => {
    if (!confirmCancelOp?.scheduledOpId) return;
    try {
      await cancelOp.mutateAsync(confirmCancelOp.scheduledOpId);
      toast({ title: 'Scheduled ramp cancelled', variant: 'success' });
      setConfirmCancelOp(null);
    } catch (err) {
      toast({ title: 'Cancel failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const canCancel = (row: UnifiedRampRow) =>
    row.isScheduled && (row.status === 'pending' || row.status === 'awaiting approval');

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Ramp History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {txsLoading ? (
          <CardSpinner />
        ) : (
          <div className="space-y-4">
          <FilterBar
            search={filter.search}
            onSearchChange={filter.setSearch}
            searchPlaceholder="Search ramps..."
            dropdowns={[
              { key: 'direction', label: 'Direction', options: filter.dropdownOptions.direction ?? [] },
              { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
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
            onExportCsv={() => exportCsv('ramp-transactions', RAMP_EXPORT_COLUMNS, filter.filteredData)}
            onExportPdf={() => exportPdf('ramp-transactions', 'Ramp History', RAMP_EXPORT_COLUMNS, filter.filteredData, 'landscape')}
          />
          {!filter.filteredData.length ? (
            <div className="text-sm text-gray-400 text-center py-8">
              {filter.activeFilterCount > 0
                ? 'No matching transactions.'
                : 'No ramp transactions yet. Use the form above to get started.'}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-sm font-medium">
                  <th className="text-left py-2 pr-4">Direction</th>
                  <th className="text-right py-2 pr-4">Crypto</th>
                  <th className="text-right py-2 pr-4">Fiat</th>
                  <th className="text-right py-2 pr-4">Rate</th>
                  <th className="text-right py-2 pr-4">Fee</th>
                  <th className="text-left py-2 pr-4">Bank</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2 pr-4">Scheduled</th>
                  <th className="text-left py-2 pr-4">Date</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filter.pagedData.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50/50">
                    <td className="py-2 pr-4">
                      <DirectionBadge direction={row.direction} />
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {parseFloat(row.crypto_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {row.crypto_token}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {parseFloat(row.fiat_amount).toLocaleString(undefined, { style: 'currency', currency: row.fiat_currency })}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-500">
                      {row.exchange_rate ? parseFloat(row.exchange_rate).toFixed(4) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-500">
                      {row.fee_amount
                        ? parseFloat(row.fee_amount).toLocaleString(undefined, { style: 'currency', currency: row.fiat_currency })
                        : '—'}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">
                      {row.bank_account
                        ? `${row.bank_account.nickname ? `${row.bank_account.nickname} – ` : ''}${row.bank_account.institution_name}${row.bank_account.last4 ? ` ****${row.bank_account.last4}` : ''}`
                        : '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="py-2 pr-4 text-sm text-muted-foreground whitespace-nowrap">
                      {row.scheduled_for ? formatDateTime(row.scheduled_for) : 'Immediate'}
                    </td>
                    <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="py-2">
                      {canCancel(row) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-3 text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400"
                          onClick={() => setConfirmCancelOp(row)}
                        >
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          <TablePagination
            page={filter.page}
            totalPages={filter.totalPages}
            pageSize={filter.pageSize}
            filteredCount={filter.filteredCount}
            onPageChange={filter.setPage}
            onPageSizeChange={filter.setPageSize}
          />
          </div>
        )}
      </CardContent>
    </Card>

    <Dialog open={!!confirmCancelOp} onOpenChange={(o) => !o && setConfirmCancelOp(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel Scheduled Ramp</DialogTitle>
        </DialogHeader>
        {confirmCancelOp && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to cancel this scheduled ramp?
            </p>
            <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Direction</span>
                <span className="font-medium">{capitalize(confirmCancelOp.direction)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Crypto</span>
                <span className="font-medium">
                  {parseFloat(confirmCancelOp.crypto_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {confirmCancelOp.crypto_token}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fiat</span>
                <span>
                  {parseFloat(confirmCancelOp.fiat_amount).toLocaleString(undefined, { style: 'currency', currency: confirmCancelOp.fiat_currency })}
                </span>
              </div>
              {confirmCancelOp.scheduled_for && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Scheduled</span>
                  <span>{formatDateTime(confirmCancelOp.scheduled_for)}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setConfirmCancelOp(null)}>Go Back</Button>
          <Button
            variant="outline"
            className="text-red-600 border-red-300 hover:bg-red-50"
            onClick={handleCancel}
            disabled={cancelOp.isPending}
          >
            {cancelOp.isPending ? 'Cancelling…' : 'Confirm Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
