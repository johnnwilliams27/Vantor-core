'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CancelScheduledDialog } from '@/components/ui/cancel-scheduled-dialog';
import { FilterBar } from '@/components/ui/filter-bar';
import { HoverTooltip } from '@/components/ui/hover-tooltip';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, formatRelativeOrDate, capitalize, formatScheduledStatus, walletDisplayName } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { FiatTransaction } from '@/types/database';
import { ArrowDownLeft, ArrowUpRight, Check, Clock, History, XCircle } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';
import { useScheduledOperations, useCancelScheduledOperation } from '@/hooks/useScheduledOperations';
import { useWallets } from '@/hooks/useWallets';
import type { RampParams } from '@/types/scheduled-operations';

function bankDisplayName(bank?: FiatTransaction['bank_account']): string {
  if (!bank) return '—';
  return `${bank.nickname ? `${bank.nickname}` : bank.institution_name}${bank.last4 ? ` ****${bank.last4}` : ''}`;
}

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
  walletLabel: string;
  bankLabel: string;
  fromLabel: string;
  toLabel: string;
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
  const variant = variantMap[status] ?? 'secondary';
  return (
    <Badge variant={variant}>
      {variant === 'success' ? <Check className="h-3 w-3 mr-1" /> :
       variant === 'destructive' ? <XCircle className="h-3 w-3 mr-1" /> :
       <Clock className="h-3 w-3 mr-1" />}
      {capitalize(status)}
    </Badge>
  );
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
  { header: 'Stablecoin Amount', accessor: (r) => parseFloat(r.crypto_amount).toLocaleString() },
  { header: 'Token', accessor: (r) => r.crypto_token },
  { header: 'Bank Amount', accessor: (r) => parseFloat(r.fiat_amount).toLocaleString() },
  { header: 'Currency', accessor: (r) => r.fiat_currency },
  { header: 'Rate', accessor: (r) => r.exchange_rate ? parseFloat(r.exchange_rate).toFixed(4) : '' },
  { header: 'Fee', accessor: (r) => r.fee_amount ? parseFloat(r.fee_amount).toLocaleString() : '' },
  { header: 'From', accessor: (r) => r.fromLabel },
  { header: 'To', accessor: (r) => r.toLabel },
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
  sortColumns: [
    { key: 'amount', accessor: (item: UnifiedRampRow) => parseFloat(item.crypto_amount), type: 'number' as const },
    { key: 'date', accessor: (item: UnifiedRampRow) => item.created_at, type: 'date' as const },
  ],
};

export function FiatTransactionTable() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const cancelOp = useCancelScheduledOperation();
  const [confirmCancelOp, setConfirmCancelOp] = useState<UnifiedRampRow | null>(null);

  const { data: wallets } = useWallets();

  const { data: txs, isLoading: txsLoading } = useQuery({
    queryKey: ['fiat-transactions'],
    queryFn: fetchFiatTransactions,
  });

  const { data: scheduledOps } = useScheduledOperations({ type: 'ramp' });

  // Merge executed ramp transactions + scheduled ops into unified rows
  const allRows: UnifiedRampRow[] = [
    ...(txs ?? []).map((tx): UnifiedRampRow => {
      const wLabel = walletDisplayName(wallets?.[0]);
      const bLabel = bankDisplayName(tx.bank_account);
      return {
        id: tx.id,
        direction: tx.direction,
        crypto_amount: tx.crypto_amount,
        crypto_token: tx.crypto_token,
        fiat_amount: tx.fiat_amount,
        fiat_currency: tx.fiat_currency,
        exchange_rate: tx.exchange_rate,
        fee_amount: tx.fee_amount,
        bank_account: tx.bank_account,
        walletLabel: wLabel,
        bankLabel: bLabel,
        fromLabel: tx.direction === 'offramp' ? wLabel : bLabel,
        toLabel: tx.direction === 'offramp' ? bLabel : wLabel,
        status: tx.status,
        created_at: tx.created_at,
        scheduled_for: null,
        isScheduled: false,
      };
    }),
    ...(scheduledOps ?? [])
      .filter((op) => op.status !== 'completed') // completed ones will show as fiat transactions
      .map((op): UnifiedRampRow => {
        const p = op.params as RampParams;
        const matchedWallet = p.walletId
          ? wallets?.find((w) => w.id === p.walletId)
          : wallets?.[0];
        const wLabel = walletDisplayName(matchedWallet);
        const bLabel = '—';
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
          walletLabel: wLabel,
          bankLabel: bLabel,
          fromLabel: p.direction === 'offramp' ? wLabel : bLabel,
          toLabel: p.direction === 'offramp' ? bLabel : wLabel,
          status: formatScheduledStatus(op.status),
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
    <Card data-history-table>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Ramp History
          {filter.totalCount > 0 && (
            <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-white/[0.06] text-muted-foreground">
              {filter.totalCount}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {txsLoading ? (
          <TableCardSkeleton columns={11} rows={5} />
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
            <div className="text-center py-12">
              {filter.activeFilterCount > 0 ? (
                <span className="text-muted-foreground">No matching results.</span>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">No transactions yet.</p>
                  <p className="text-xs text-teal-400 hover:text-teal-300 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                    Create your first transactions ↑
                  </p>
                </div>
              )}
            </div>
          ) : (
          <div className="relative overflow-x-auto">
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-black/40 to-transparent lg:hidden z-10" />
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-sm font-medium">
                  <th scope="col" className="text-left py-2 pr-4">Direction</th>
                  <th scope="col" className="text-right py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => filter.toggleSort('amount')}
                      className="ml-auto flex items-center gap-1 hover:text-white transition-colors group"
                      aria-sort={filter.sortKey === 'amount' ? (filter.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      Stablecoin
                      <span className={`text-[10px] ${filter.sortKey === 'amount' ? 'text-teal-400' : 'opacity-0 group-hover:opacity-40'}`}>
                        {filter.sortKey === 'amount' ? (filter.sortDir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  </th>
                  <th scope="col" className="text-right py-2 pr-4">Bank</th>
                  <th scope="col" className="hidden lg:table-cell text-right py-2 pr-4">Rate</th>
                  <th scope="col" className="hidden lg:table-cell text-right py-2 pr-4">
                    <HoverTooltip label="Includes Vantor fee (0.25%) + provider fee">
                      <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">Total Fee</span>
                    </HoverTooltip>
                  </th>
                  <th scope="col" className="text-left py-2 pr-4">From</th>
                  <th scope="col" className="text-left py-2 pr-4">To</th>
                  <th scope="col" className="text-left py-2 pr-4">Status</th>
                  <th scope="col" className="text-left py-2 pr-4">Scheduled</th>
                  <th scope="col" className="text-left py-2 pr-4">
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
                  </th>
                  <th scope="col" className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filter.pagedData.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-white/[0.02]">
                    <td className="py-2 pr-4">
                      <DirectionBadge direction={row.direction} />
                    </td>
                    <td className="py-2 pr-4 text-sm text-right">
                      {parseFloat(row.crypto_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {row.crypto_token}
                    </td>
                    <td className="py-2 pr-4 text-sm text-right">
                      {parseFloat(row.fiat_amount).toLocaleString(undefined, { style: 'currency', currency: row.fiat_currency })}
                    </td>
                    <td className="hidden lg:table-cell py-2 pr-4 text-right text-muted-foreground">
                      {row.exchange_rate ? parseFloat(row.exchange_rate).toFixed(4) : '—'}
                    </td>
                    <td className="hidden lg:table-cell py-2 pr-4 text-right text-muted-foreground">
                      {row.fee_amount
                        ? parseFloat(row.fee_amount).toLocaleString(undefined, { style: 'currency', currency: row.fiat_currency })
                        : '—'}
                    </td>
                    <td className="py-2 pr-4 text-sm">
                      {row.fromLabel}
                    </td>
                    <td className="py-2 pr-4 text-sm">
                      {row.toLabel}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="py-2 pr-4 text-sm text-muted-foreground whitespace-nowrap">
                      {row.scheduled_for ? formatDateTime(row.scheduled_for) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-sm text-muted-foreground whitespace-nowrap">
                      <HoverTooltip label={formatRelativeOrDate(row.created_at).full}>
                        <span>{formatRelativeOrDate(row.created_at).text}</span>
                      </HoverTooltip>
                    </td>
                    <td className="py-2">
                      {canCancel(row) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 text-xs px-3 text-red-400 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/30"
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

    <CancelScheduledDialog
      open={!!confirmCancelOp}
      onOpenChange={(o) => !o && setConfirmCancelOp(null)}
      title="Cancel Scheduled Ramp"
      details={confirmCancelOp ? [
        { label: 'Direction', value: capitalize(confirmCancelOp.direction) },
        { label: 'Stablecoin', value: `${parseFloat(confirmCancelOp.crypto_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${confirmCancelOp.crypto_token}` },
        { label: 'Bank Amount', value: parseFloat(confirmCancelOp.fiat_amount).toLocaleString(undefined, { style: 'currency', currency: confirmCancelOp.fiat_currency }) },
        ...(confirmCancelOp.scheduled_for ? [{ label: 'Scheduled', value: formatDateTime(confirmCancelOp.scheduled_for) }] : []),
      ] : []}
      onConfirm={handleCancel}
      isPending={cancelOp.isPending}
    />
    </>
  );
}
