'use client';
import { SendTransferForm } from '@/components/transfers/SendTransferForm';
import { ScheduleTransferForm } from '@/components/transfers/ScheduleTransferForm';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, truncateAddress, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { Transfer } from '@/types/database';
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

const TRANSFER_FILTER_CONFIG = {
  searchFields: [
    'to_address' as const,
    'token' as const,
    'memo' as const,
  ],
  dropdowns: [
    { key: 'status', accessor: (item: Transfer) => item.status },
    { key: 'token', accessor: (item: Transfer) => item.token },
    { key: 'chain', accessor: (item: Transfer) => item.chain },
    { key: 'erp', accessor: (item: Transfer) => item.erp_config?.provider?.toUpperCase() ?? 'None' },
  ],
  dateField: (item: Transfer) => item.created_at,
};

const EXPORT_COLUMNS: ExportColumn<Transfer>[] = [
  { header: 'To', accessor: (r) => truncateAddress(r.to_address, 6) },
  { header: 'Amount', accessor: (r) => formatCurrency(r.amount) },
  { header: 'Token', accessor: (r) => r.token },
  { header: 'Chain', accessor: (r) => capitalize(r.chain) },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
  { header: 'ERP', accessor: (r) => r.erp_config?.provider?.toUpperCase() ?? 'None' },
  { header: 'Scheduled', accessor: (r) => r.scheduled_for ? formatDateTime(r.scheduled_for) : 'Immediate' },
  { header: 'Date', accessor: (r) => formatDateTime(r.created_at) },
];

function TransferList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      const res = await fetch(`/api/transfers/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Cancel failed');
      }
      toast({ title: 'Transfer cancelled', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
    } catch (err) {
      toast({ title: 'Cancel failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setCancellingId(null);
      setConfirmCancelId(null);
    }
  };

  const { data, isLoading } = useQuery<Transfer[]>({
    queryKey: ['transfers'],
    queryFn: async () => {
      const res = await fetch('/api/transfers');
      if (!res.ok) throw new Error('Failed to load');
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, TRANSFER_FILTER_CONFIG);

  return (
    <>
    <Card>
      <CardHeader><CardTitle>Transfer History</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search transfers..."
          dropdowns={[
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
            { key: 'token', label: 'Token', options: filter.dropdownOptions.token ?? [] },
            { key: 'chain', label: 'Chain', options: filter.dropdownOptions.chain ?? [] },
            { key: 'erp', label: 'ERP', options: filter.dropdownOptions.erp ?? [] },
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
          onExportCsv={() => exportCsv('transfers', EXPORT_COLUMNS, filter.filteredData)}
          onExportPdf={() => exportPdf('transfers', 'Transfer History', EXPORT_COLUMNS, filter.filteredData, 'landscape')}
        />
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>ERP</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Date</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={10}>
                  <CardSpinner />
                </TableCell>
              </TableRow>
            ) : filter.pagedData.length ? (
              filter.pagedData.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">
                    {p.from_wallet?.label || (p.from_wallet?.address ? `${p.from_wallet.address.slice(0, 6)}…${p.from_wallet.address.slice(-4)}` : '—')}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{truncateAddress(p.to_address, 6)}</TableCell>
                  <TableCell className="text-sm">
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
                  <TableCell>
                    {p.status === 'pending' && (
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
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  {filter.activeFilterCount > 0 ? 'No matching transfers.' : 'No transfers yet.'}
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
      const cancelTransfer = data?.find((p) => p.id === confirmCancelId);
      return (
        <Dialog open={!!confirmCancelId} onOpenChange={(o) => !o && setConfirmCancelId(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Cancel Transfer</DialogTitle>
            </DialogHeader>
            {cancelTransfer && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Are you sure you want to cancel this scheduled transfer?
                </p>
                <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-medium">{formatCurrency(cancelTransfer.amount)} {cancelTransfer.token}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">To</span>
                    <span className="font-mono text-xs">{truncateAddress(cancelTransfer.to_address, 8)}</span>
                  </div>
                  {cancelTransfer.scheduled_for && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Scheduled</span>
                      <span>{formatDateTime(cancelTransfer.scheduled_for)}</span>
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
    </>
  );
}

export default function TransfersPage() {
  return (
    <>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SendTransferForm />
          <ScheduleTransferForm />
        </div>
        <TransferList />
      </div>
    </>
  );
}
