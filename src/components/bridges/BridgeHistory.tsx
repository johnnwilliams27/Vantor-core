'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CancelScheduledDialog } from '@/components/ui/cancel-scheduled-dialog';
import { FilterBar } from '@/components/ui/filter-bar';
import { HoverTooltip } from '@/components/ui/hover-tooltip';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { useToast } from '@/components/ui/toast';
import { formatCurrency, formatDateTime, formatRelativeOrDate, capitalize, formatScheduledStatus, walletDisplayName } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { BridgeTransfer } from '@/types/database';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';
import { TruncatedAddress } from '@/components/ui/truncated-address';
import { ArrowRight, Check, Clock, XCircle } from 'lucide-react';
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
  fromWalletLabel: string;
  toWalletLabel: string;
  fromWalletAddress?: string;
  toWalletAddress?: string;
  bridge_fee: string | null;
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
  sortColumns: [
    { key: 'amount', accessor: (item: UnifiedBridgeRow) => parseFloat(item.amount), type: 'number' as const },
    { key: 'date', accessor: (item: UnifiedBridgeRow) => item.created_at, type: 'date' as const },
  ],
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
      fromWalletLabel: walletDisplayName(b.from_wallet),
      toWalletLabel: walletDisplayName(b.to_wallet),
      fromWalletAddress: b.from_wallet?.label ? undefined : b.from_wallet?.address,
      toWalletAddress: b.to_wallet?.label ? undefined : b.to_wallet?.address,
      bridge_fee: b.bridge_fee ?? null,
      status: b.status,
      created_at: b.created_at,
      scheduled_for: null,
      isScheduled: false,
    })),
    ...(scheduledOps ?? [])
      .filter((op) => op.status !== 'completed') // completed ones will show as bridge_transfers
      .map((op): UnifiedBridgeRow => {
        const p = op.params as BridgeParams;
        const truncated = p.walletAddress
          ? `${p.walletAddress.slice(0, 6)}…${p.walletAddress.slice(-4)}`
          : '—';
        return {
          id: `sched-${op.id}`,
          token: p.token,
          amount: p.amount,
          received_amount: null,
          from_chain: p.fromChain,
          to_chain: p.toChain,
          fromWalletLabel: truncated,
          toWalletLabel: truncated,
          fromWalletAddress: p.walletAddress ?? undefined,
          toWalletAddress: p.walletAddress ?? undefined,
          bridge_fee: null,
          status: formatScheduledStatus(op.status),
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
    return <TableCardSkeleton columns={10} rows={5} />;
  }

  return (
    <>
    <Card data-history-table>
      <CardHeader><CardTitle className="flex items-center gap-2">
          Bridge History
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
        <div className="relative overflow-x-auto">
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-black/40 to-transparent lg:hidden z-10" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Token</TableHead>
                <TableHead scope="col">
                  <button
                    type="button"
                    onClick={() => filter.toggleSort('amount')}
                    className="flex items-center gap-1 hover:text-white transition-colors group"
                    aria-sort={filter.sortKey === 'amount' ? (filter.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    Amount
                    <span className={`text-[10px] ${filter.sortKey === 'amount' ? 'text-teal-400' : 'opacity-0 group-hover:opacity-40'}`}>
                      {filter.sortKey === 'amount' ? (filter.sortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </TableHead>
                <TableHead scope="col">From</TableHead>
                <TableHead scope="col">To</TableHead>
                <TableHead scope="col">Route</TableHead>
                <TableHead scope="col">Fee</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Scheduled</TableHead>
                <TableHead scope="col">
                  <button
                    type="button"
                    onClick={() => filter.toggleSort('date')}
                    className="flex items-center gap-1 hover:text-white transition-colors group"
                    aria-sort={filter.sortKey === 'date' ? (filter.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    Date
                    <span className={`text-[10px] ${filter.sortKey === 'date' ? 'text-teal-400' : 'opacity-0 group-hover:opacity-40'}`}>
                      {filter.sortKey === 'date' ? (filter.sortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </TableHead>
                <TableHead scope="col"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filter.pagedData.length ? (
                filter.pagedData.map((b) => (
                  <TableRow key={b.id} className="hover:bg-white/[0.02]">
                    <TableCell><Badge variant="outline">{b.token}</Badge></TableCell>
                    <TableCell className="text-sm font-semibold tabular-nums">{formatCurrency(b.amount)}</TableCell>
                    <TableCell className="text-sm text-foreground">
                      {b.fromWalletAddress ? <TruncatedAddress address={b.fromWalletAddress} /> : b.fromWalletLabel}
                    </TableCell>
                    <TableCell className="text-sm text-foreground">
                      {b.toWalletAddress ? <TruncatedAddress address={b.toWalletAddress} /> : b.toWalletLabel}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className={`w-2 h-2 rounded-full ${b.from_chain === 'ethereum' ? 'bg-blue-400' : 'bg-purple-400'}`} />
                        <span className="text-muted-foreground">{capitalize(b.from_chain)}</span>
                        {b.status === 'completed' ? (
                          <Check className="h-3 w-3 text-teal-400" />
                        ) : b.status === 'pending' || b.status === 'awaiting approval' ? (
                          <ArrowRight className="h-3 w-3 text-white/40 animate-pulse" />
                        ) : (
                          <ArrowRight className="h-3 w-3 text-white/20" />
                        )}
                        <span className={`w-2 h-2 rounded-full ${b.to_chain === 'ethereum' ? 'bg-blue-400' : 'bg-purple-400'}`} />
                        <span className="text-muted-foreground">{capitalize(b.to_chain)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {b.bridge_fee && parseFloat(b.bridge_fee) > 0
                        ? `${parseFloat(b.bridge_fee).toFixed(4)} ${b.token}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        b.status === 'completed' ? 'success' as any :
                        b.status === 'failed' || b.status === 'cancelled' ? 'destructive' :
                        'warning' as any
                      }>
                        {b.status === 'completed' ? <Check className="h-3 w-3 mr-1" /> :
                         b.status === 'failed' || b.status === 'cancelled' ? <XCircle className="h-3 w-3 mr-1" /> :
                         <Clock className="h-3 w-3 mr-1" />}
                        {capitalize(b.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {b.scheduled_for ? formatDateTime(b.scheduled_for) : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      <HoverTooltip label={formatRelativeOrDate(b.created_at).full}>
                        <span>{formatRelativeOrDate(b.created_at).text}</span>
                      </HoverTooltip>
                    </TableCell>
                    <TableCell>
                      {canCancel(b) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 text-xs px-3 text-red-400 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/30"
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
                  <TableCell colSpan={10} className="text-center py-12">
                    {filter.activeFilterCount > 0 ? (
                      <span className="text-muted-foreground">No matching results.</span>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-muted-foreground">No bridge transfers yet.</p>
                        <p className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                          Create your first bridge transfers ↑
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

    <CancelScheduledDialog
      open={!!confirmCancelOp}
      onOpenChange={(o) => !o && setConfirmCancelOp(null)}
      title="Cancel Scheduled Bridge"
      details={confirmCancelOp ? [
        { label: 'Amount', value: `${formatCurrency(confirmCancelOp.amount)} ${confirmCancelOp.token}` },
        { label: 'Route', value: `${capitalize(confirmCancelOp.from_chain)} → ${capitalize(confirmCancelOp.to_chain)}` },
        ...(confirmCancelOp.scheduled_for ? [{ label: 'Scheduled', value: formatDateTime(confirmCancelOp.scheduled_for) }] : []),
      ] : []}
      onConfirm={handleCancel}
      isPending={cancelOp.isPending}
    />
    </>
  );
}
