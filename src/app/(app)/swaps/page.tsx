'use client';
import { SwapForm } from '@/components/swaps/SwapForm';
import { useState } from 'react';
import { ScheduleSwapForm } from '@/components/scheduled/ScheduleSwapForm';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { useToast } from '@/components/ui/toast';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { Swap } from '@/types/database';
import { CardSpinner } from '@/components/ui/spinner';
import { useScheduledOperations, useCancelScheduledOperation } from '@/hooks/useScheduledOperations';
import type { ScheduledOperation, SwapParams } from '@/types/scheduled-operations';

const SWAP_EXPORT_COLUMNS: ExportColumn<Swap>[] = [
  { header: 'From Amount', accessor: (r) => formatCurrency(r.from_amount) },
  { header: 'From Token', accessor: (r) => r.from_token },
  { header: 'To Amount', accessor: (r) => formatCurrency(r.to_amount ?? r.from_amount) },
  { header: 'To Token', accessor: (r) => r.to_token },
  { header: 'Chain', accessor: (r) => capitalize(r.chain) },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
  { header: 'Date', accessor: (r) => formatDateTime(r.created_at) },
];

const SWAP_FILTER_CONFIG = {
  searchFields: [
    'from_token' as const,
    'to_token' as const,
  ],
  dropdowns: [
    { key: 'status', accessor: (item: UnifiedSwapRow) => item.status },
    { key: 'chain', accessor: (item: UnifiedSwapRow) => item.chain },
  ],
  dateField: (item: UnifiedSwapRow) => item.created_at,
};

interface UnifiedSwapRow {
  id: string;
  from_amount: string;
  from_token: string;
  to_amount: string | null;
  to_token: string;
  chain: string;
  status: string;
  created_at: string;
  scheduled_for: string | null;
  isScheduled: boolean;
  scheduledOpId?: string;
  walletLabel: string;
  rate: string | null;
}

function walletDisplayName(wallet?: { label?: string | null; address: string } | null): string {
  if (!wallet) return '—';
  return wallet.label || `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
}

function SwapHistory() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const cancelOp = useCancelScheduledOperation();
  const [confirmCancelOp, setConfirmCancelOp] = useState<UnifiedSwapRow | null>(null);

  const { data: swaps, isLoading: swapsLoading } = useQuery<Swap[]>({
    queryKey: ['swaps'],
    queryFn: async () => {
      const res = await fetch('/api/swaps');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const { data: scheduledOps } = useScheduledOperations({ type: 'swap' });

  // Merge executed swaps + scheduled ops into unified rows
  const allRows: UnifiedSwapRow[] = [
    ...(swaps ?? []).map((s): UnifiedSwapRow => ({
      id: s.id,
      from_amount: s.from_amount,
      from_token: s.from_token,
      to_amount: s.to_amount,
      to_token: s.to_token,
      chain: s.chain,
      status: s.status,
      created_at: s.created_at,
      scheduled_for: null,
      isScheduled: false,
      walletLabel: walletDisplayName(s.wallet),
      rate: s.rate ?? null,
    })),
    ...(scheduledOps ?? [])
      .filter((op) => op.status !== 'completed')
      .map((op): UnifiedSwapRow => {
        const p = op.params as SwapParams;
        return {
          id: `sched-${op.id}`,
          from_amount: p.amount,
          from_token: p.fromToken,
          to_amount: null,
          to_token: p.toToken,
          chain: p.chain,
          status: op.status === 'awaiting_authorization' ? 'awaiting approval' : op.status,
          created_at: op.created_at,
          scheduled_for: op.scheduled_for,
          isScheduled: true,
          scheduledOpId: op.id,
          walletLabel: p.walletAddress ? `${p.walletAddress.slice(0, 6)}…${p.walletAddress.slice(-4)}` : '—',
          rate: null,
        };
      }),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const filter = useTableFilter(allRows, SWAP_FILTER_CONFIG);

  const handleCancel = async () => {
    if (!confirmCancelOp?.scheduledOpId) return;
    try {
      await cancelOp.mutateAsync(confirmCancelOp.scheduledOpId);
      toast({ title: 'Scheduled swap cancelled', variant: 'success' });
      setConfirmCancelOp(null);
    } catch (err) {
      toast({ title: 'Cancel failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const canCancel = (row: UnifiedSwapRow) =>
    row.isScheduled && (row.status === 'pending' || row.status === 'awaiting approval');

  if (swapsLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Swap History</CardTitle></CardHeader>
        <CardContent>
          <CardSpinner />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader><CardTitle>Swap History</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search swaps..."
          dropdowns={[
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
            { key: 'chain', label: 'Chain', options: filter.dropdownOptions.chain ?? [] },
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
          onExportCsv={() => exportCsv('swaps', SWAP_EXPORT_COLUMNS, filter.filteredData as any)}
          onExportPdf={() => exportPdf('swaps', 'Swap History', SWAP_EXPORT_COLUMNS, filter.filteredData as any)}
        />
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Date</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filter.pagedData.length ? (
              filter.pagedData.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">
                    <span className="font-semibold">{formatCurrency(s.from_amount)}</span>{' '}
                    <Badge variant="outline">{s.from_token}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="font-semibold">{formatCurrency(s.to_amount ?? s.from_amount)}</span>{' '}
                    <Badge variant="outline">{s.to_token}</Badge>
                    {!s.to_amount && <span className="text-xs text-muted-foreground ml-1">(est.)</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {s.rate ? parseFloat(s.rate).toFixed(4) : '—'}
                  </TableCell>
                  <TableCell className="text-sm">{s.walletLabel}</TableCell>
                  <TableCell><Badge variant={s.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(s.chain)}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={
                      s.status === 'completed' ? 'success' as any :
                      s.status === 'failed' || s.status === 'cancelled' ? 'destructive' :
                      'warning' as any
                    }>
                      {capitalize(s.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {s.scheduled_for ? formatDateTime(s.scheduled_for) : 'Immediate'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(s.created_at)}
                  </TableCell>
                  <TableCell>
                    {canCancel(s) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-3 text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400"
                        onClick={() => setConfirmCancelOp(s)}
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
                  {filter.activeFilterCount > 0 ? 'No matching swaps.' : 'No swaps yet.'}
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

    <Dialog open={!!confirmCancelOp} onOpenChange={(o) => !o && setConfirmCancelOp(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel Scheduled Swap</DialogTitle>
        </DialogHeader>
        {confirmCancelOp && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to cancel this scheduled swap?
            </p>
            <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-medium">{formatCurrency(confirmCancelOp.from_amount)} {confirmCancelOp.from_token} → {confirmCancelOp.to_token}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Chain</span>
                <span>{capitalize(confirmCancelOp.chain)}</span>
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

export default function SwapsPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SwapForm />
        <ScheduleSwapForm />
      </div>
      <SwapHistory />
    </div>
  );
}
