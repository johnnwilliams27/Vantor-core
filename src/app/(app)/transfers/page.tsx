'use client';
import { SendTransferForm } from '@/components/transfers/SendTransferForm';
import { ScheduleTransferForm } from '@/components/transfers/ScheduleTransferForm';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ChainBadge } from '@/components/ui/icons/chain-logos';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, formatRelativeOrDate, capitalize, truncateAddress } from '@/lib/utils';
import { TruncatedAddress } from '@/components/ui/truncated-address';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { Transfer } from '@/types/database';
import { CardSpinner } from '@/components/ui/spinner';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { CancelScheduledDialog } from '@/components/ui/cancel-scheduled-dialog';
import { HoverTooltip } from '@/components/ui/hover-tooltip';
import { Check, Clock, XCircle } from 'lucide-react';

// Migrated to semantic badge variants (style guide Stage 3b).
// pending/processing → pending (amber, user waits) · completed → active
// (teal, matches STATUS_BADGE.executed) · failed → failed (red) ·
// cancelled → inactive (gray).
const STATUS_COLORS: Record<string, string> = {
  pending: 'pending',
  processing: 'pending',
  completed: 'active',
  failed: 'failed',
  cancelled: 'inactive',
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
  sortColumns: [
    { key: 'amount', accessor: (item: Transfer) => parseFloat(item.amount), type: 'number' as const },
    { key: 'date', accessor: (item: Transfer) => item.created_at, type: 'date' as const },
  ],
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
  const hasErpData = filter.filteredData.some((t: any) => t.erp_config);

  return (
    <>
    <Card data-history-table>
      <CardHeader><CardTitle className="flex items-center gap-2">
          Transfer History
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
              <TableHead scope="col">Token</TableHead>
              <TableHead scope="col">Chain</TableHead>
              <TableHead scope="col">Status</TableHead>
              {hasErpData && <TableHead scope="col">ERP</TableHead>}
              <TableHead scope="col">Scheduled</TableHead>
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
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={hasErpData ? 10 : 9}>
                  <TableCardSkeleton columns={10} rows={5} />
                </TableCell>
              </TableRow>
            ) : filter.pagedData.length ? (
              filter.pagedData.map((p) => (
                <TableRow key={p.id} className="hover:bg-white/[0.02]">
                  <TableCell className="text-sm">
                    {p.from_wallet?.label
                      ? p.from_wallet.label
                      : p.from_wallet?.address
                        ? <TruncatedAddress address={p.from_wallet.address} />
                        : '—'}
                  </TableCell>
                  <TableCell>
                    {p.to_address ? <TruncatedAddress address={p.to_address} /> : '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="font-semibold">{formatCurrency(p.amount)}</span>
                  </TableCell>
                  <TableCell><Badge variant="outline">{p.token}</Badge></TableCell>
                  <TableCell><Badge variant={p.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(p.chain)}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLORS[p.status] as any}>
                      {p.status === 'completed' ? <Check className="h-3 w-3 mr-1" /> :
                       p.status === 'failed' || p.status === 'cancelled' ? <XCircle className="h-3 w-3 mr-1" /> :
                       <Clock className="h-3 w-3 mr-1" />}
                      {capitalize(p.status)}
                    </Badge>
                  </TableCell>
                  {hasErpData && (
                    <TableCell className="text-sm">
                      {p.erp_config ? (
                        <HoverTooltip label={p.erp_config.label}>
                          <span>{p.erp_config.provider.toUpperCase()}</span>
                        </HoverTooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {p.scheduled_for ? formatDateTime(p.scheduled_for) : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    <HoverTooltip label={formatRelativeOrDate(p.created_at).full}>
                      <span>{formatRelativeOrDate(p.created_at).text}</span>
                    </HoverTooltip>
                  </TableCell>
                  <TableCell>
                    {p.status === 'pending' && (
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
                <TableCell colSpan={hasErpData ? 10 : 9} className="text-center py-12">
                  {filter.activeFilterCount > 0 ? (
                    <span className="text-muted-foreground">No matching results.</span>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-muted-foreground">No transfers yet.</p>
                      <p className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                        Create your first transfers ↑
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
      const cancelTransfer = data?.find((p) => p.id === confirmCancelId);
      return (
        <CancelScheduledDialog
          open={!!confirmCancelId}
          onOpenChange={(o) => !o && setConfirmCancelId(null)}
          title="Cancel Transfer"
          details={cancelTransfer ? [
            { label: 'Amount', value: `${formatCurrency(cancelTransfer.amount)} ${cancelTransfer.token}` },
            { label: 'To', value: truncateAddress(cancelTransfer.to_address, 8) },
            ...(cancelTransfer.scheduled_for ? [{ label: 'Scheduled', value: formatDateTime(cancelTransfer.scheduled_for) }] : []),
          ] : []}
          onConfirm={() => confirmCancelId && handleCancel(confirmCancelId)}
          isPending={!!cancellingId}
        />
      );
    })()}
    </>
  );
}

export default function TransfersPage() {
  return (
    <>
      <div className="space-y-6 animate-in fade-in duration-200">
        <h1 className="text-xl font-semibold text-white">Transfers</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SendTransferForm />
          <ScheduleTransferForm />
        </div>
        <TransferList />
      </div>
    </>
  );
}
