'use client';
import { useState } from 'react';
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
import type { BridgeTransfer } from '@/types/database';
import { CardSpinner } from '@/components/ui/spinner';
import { ArrowRight } from 'lucide-react';
import { useScheduledOperations, useCancelScheduledOperation } from '@/hooks/useScheduledOperations';
import type { BridgeParams } from '@/types/scheduled-operations';

const PROVIDER_LABELS: Record<string, string> = {
  cctp: 'Circle CCTP',
  layerzero: 'LayerZero',
};

const BRIDGE_EXPORT_COLUMNS: ExportColumn<BridgeTransfer>[] = [
  { header: 'Date', accessor: (r) => formatDateTime(r.executed_at ?? r.created_at) },
  { header: 'Token', accessor: (r) => r.token },
  { header: 'Amount', accessor: (r) => formatCurrency(r.amount) },
  { header: 'From Chain', accessor: (r) => capitalize(r.from_chain) },
  { header: 'To Chain', accessor: (r) => capitalize(r.to_chain) },
  { header: 'Fee', accessor: (r) => r.bridge_fee ?? '0' },
  { header: 'Provider', accessor: (r) => PROVIDER_LABELS[r.provider] ?? r.provider },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
];

interface UnifiedBridgeRow {
  id: string;
  token: string;
  amount: string;
  received_amount: string | null;
  from_chain: string;
  to_chain: string;
  status: string;
  created_at: string;
  scheduled_for: string | null;
  isScheduled: boolean;
  scheduledOpId?: string;
}

const BRIDGE_FILTER_CONFIG = {
  searchFields: [
    'token' as const,
  ],
  dropdowns: [
    { key: 'status', accessor: (item: UnifiedBridgeRow) => item.status },
    { key: 'token', accessor: (item: UnifiedBridgeRow) => item.token },
  ],
  dateField: (item: UnifiedBridgeRow) => item.created_at,
};

export function BridgeHistory() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const cancelOp = useCancelScheduledOperation();
  const [confirmCancelOp, setConfirmCancelOp] = useState<UnifiedBridgeRow | null>(null);

  const { data: bridges, isLoading: bridgesLoading } = useQuery<BridgeTransfer[]>({
    queryKey: ['bridge-transfers'],
    queryFn: async () => {
      const res = await fetch('/api/bridges');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const { data: scheduledOps } = useScheduledOperations({ type: 'bridge' });

  // Merge executed bridge_transfers + scheduled ops into unified rows
  const allRows: UnifiedBridgeRow[] = [
    ...(bridges ?? []).map((b): UnifiedBridgeRow => ({
      id: b.id,
      token: b.token,
      amount: b.amount,
      received_amount: b.received_amount ?? null,
      from_chain: b.from_chain,
      to_chain: b.to_chain,
      status: b.status,
      created_at: b.created_at,
      scheduled_for: null,
      isScheduled: false,
    })),
    ...(scheduledOps ?? [])
      .filter((op) => op.status !== 'completed') // completed ones will show as bridge_transfers
      .map((op): UnifiedBridgeRow => {
        const p = op.params as BridgeParams;
        return {
          id: `sched-${op.id}`,
          token: p.token,
          amount: p.amount,
          received_amount: null,
          from_chain: p.fromChain,
          to_chain: p.toChain,
          status: op.status === 'awaiting_authorization' ? 'awaiting approval' : op.status,
          created_at: op.created_at,
          scheduled_for: op.scheduled_for,
          isScheduled: true,
          scheduledOpId: op.id,
        };
      }),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const filter = useTableFilter(allRows, BRIDGE_FILTER_CONFIG);

  const handleCancel = async () => {
    if (!confirmCancelOp?.scheduledOpId) return;
    try {
      await cancelOp.mutateAsync(confirmCancelOp.scheduledOpId);
      toast({ title: 'Scheduled bridge cancelled', variant: 'success' });
      setConfirmCancelOp(null);
    } catch (err) {
      toast({ title: 'Cancel failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const canCancel = (row: UnifiedBridgeRow) =>
    row.isScheduled && (row.status === 'pending' || row.status === 'awaiting approval');

  if (bridgesLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Bridge History</CardTitle></CardHeader>
        <CardContent><CardSpinner /></CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader><CardTitle>Bridge History</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search bridges..."
          dropdowns={[
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
            { key: 'token', label: 'Token', options: filter.dropdownOptions.token ?? [] },
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
          onExportCsv={() => exportCsv('bridge-history', BRIDGE_EXPORT_COLUMNS, filter.filteredData as any)}
          onExportPdf={() => exportPdf('bridge-history', 'Bridge History', BRIDGE_EXPORT_COLUMNS, filter.filteredData as any, 'landscape')}
        />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Token</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Date</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filter.pagedData.length ? (
                filter.pagedData.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><Badge variant="outline">{b.token}</Badge></TableCell>
                    <TableCell className="font-semibold">{formatCurrency(b.amount)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm">
                        <Badge variant={b.from_chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(b.from_chain)}</Badge>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <Badge variant={b.to_chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(b.to_chain)}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        b.status === 'completed' ? 'success' as any :
                        b.status === 'failed' || b.status === 'cancelled' ? 'destructive' :
                        'warning' as any
                      }>
                        {capitalize(b.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {b.scheduled_for ? formatDateTime(b.scheduled_for) : 'Immediate'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDateTime(b.created_at)}
                    </TableCell>
                    <TableCell>
                      {canCancel(b) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-3 text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400"
                          onClick={() => setConfirmCancelOp(b)}
                        >
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {filter.activeFilterCount > 0 ? 'No matching bridges.' : 'No bridge transfers yet.'}
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
          <DialogTitle>Cancel Scheduled Bridge</DialogTitle>
        </DialogHeader>
        {confirmCancelOp && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to cancel this scheduled bridge?
            </p>
            <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-medium">{formatCurrency(confirmCancelOp.amount)} {confirmCancelOp.token}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Route</span>
                <span>{capitalize(confirmCancelOp.from_chain)} → {capitalize(confirmCancelOp.to_chain)}</span>
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
