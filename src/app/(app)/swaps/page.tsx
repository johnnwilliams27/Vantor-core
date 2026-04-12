'use client';
import { SwapForm } from '@/components/swaps/SwapForm';
import { useState } from 'react';
import { ScheduleSwapForm } from '@/components/scheduled/ScheduleSwapForm';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CancelScheduledDialog } from '@/components/ui/cancel-scheduled-dialog';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { useToast } from '@/components/ui/toast';
import { formatCurrency, formatDateTime, formatRelativeOrDate, capitalize, formatScheduledStatus, walletDisplayName } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { Swap } from '@/types/database';
import { useScheduledOperations, useCancelScheduledOperation } from '@/hooks/useScheduledOperations';
import type { ScheduledOperation, SwapParams } from '@/types/scheduled-operations';
import { Check, Clock, XCircle, ArrowLeftRight } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useSession } from 'next-auth/react';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';

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
  sortColumns: [
    { key: 'amount', accessor: (item: UnifiedSwapRow) => parseFloat(item.from_amount), type: 'number' as const },
    { key: 'date', accessor: (item: UnifiedSwapRow) => item.created_at, type: 'date' as const },
  ],
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
          status: formatScheduledStatus(op.status),
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
    return <TableCardSkeleton columns={9} rows={5} />;
  }

  return (
    <>
    <Card data-history-table>
      <CardHeader><CardTitle className="flex items-center gap-2">
          Swap History
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
        <div className="relative overflow-x-auto">
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-black/40 to-transparent lg:hidden z-10" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                <button
                  type="button"
                  onClick={() => filter.toggleSort('amount')}
                  className="flex items-center gap-1 hover:text-white transition-colors group"
                  aria-sort={filter.sortKey === 'amount' ? (filter.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  From
                  <span className={`text-[10px] ${filter.sortKey === 'amount' ? 'text-teal-400' : 'opacity-0 group-hover:opacity-40'}`}>
                    {filter.sortKey === 'amount' ? (filter.sortDir === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
                </button>
              </TableHead>
              <TableHead scope="col">To</TableHead>
              <TableHead scope="col">Rate</TableHead>
              <TableHead scope="col">Wallet</TableHead>
              <TableHead scope="col">Chain</TableHead>
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
              filter.pagedData.map((s) => (
                <TableRow key={s.id} className="hover:bg-white/[0.02]">
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
                      {s.status === 'completed' ? <Check className="h-3 w-3 mr-1" /> :
                       s.status === 'failed' || s.status === 'cancelled' ? <XCircle className="h-3 w-3 mr-1" /> :
                       <Clock className="h-3 w-3 mr-1" />}
                      {capitalize(s.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {s.scheduled_for ? formatDateTime(s.scheduled_for) : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap" title={formatRelativeOrDate(s.created_at).full}>
                    {formatRelativeOrDate(s.created_at).text}
                  </TableCell>
                  <TableCell>
                    {canCancel(s) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 text-xs px-3 text-red-400 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/30"
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
                <TableCell colSpan={9} className="text-center py-12">
                  {filter.activeFilterCount > 0 ? (
                    <span className="text-muted-foreground">No matching results.</span>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-muted-foreground">No swaps yet.</p>
                      <p className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                        Create your first swaps ↑
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
      title="Cancel Scheduled Swap"
      details={confirmCancelOp ? [
        { label: 'Amount', value: `${formatCurrency(confirmCancelOp.from_amount)} ${confirmCancelOp.from_token} → ${confirmCancelOp.to_token}` },
        { label: 'Chain', value: capitalize(confirmCancelOp.chain) },
        ...(confirmCancelOp.scheduled_for ? [{ label: 'Scheduled', value: formatDateTime(confirmCancelOp.scheduled_for) }] : []),
      ] : []}
      onConfirm={handleCancel}
      isPending={cancelOp.isPending}
    />
    </>
  );
}

export default function SwapsPage() {
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
              <ArrowLeftRight className="h-5 w-5" />
              Token Swaps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center">
              <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
              <p className="text-base font-semibold mb-2">Coming soon</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                Stablecoin swaps (USDC ↔ USDT) are being rewired through a
                dedicated DEX aggregator to give you real on-chain execution
                and pricing. We&apos;ll open this back up once the integration
                is complete.
              </p>
              <p className="text-xs text-muted-foreground mt-4 max-w-md mx-auto">
                In the meantime, you can still view historical swap records in
                reporting exports, and use on-chain transfers from your wallets
                for any immediate rebalancing.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <h1 className="text-xl font-semibold text-white">Swaps</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SwapForm />
        <ScheduleSwapForm />
      </div>
      <SwapHistory />
    </div>
  );
}
