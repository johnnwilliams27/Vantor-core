'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import { CardSpinner } from '@/components/ui/spinner';
import type { Payment, Swap, FiatTransaction, Transaction, YieldTransaction } from '@/types/database';

interface UnifiedRow {
  id: string;
  type: 'payment' | 'swap' | 'ramp' | 'onchain' | 'yield';
  date: string;
  amount: string;
  token: string;
  chain: string | null;
  status: string;
  description: string;
}

function mapPayments(payments: Payment[]): UnifiedRow[] {
  return payments.map((p) => ({
    id: `payment-${p.id}`,
    type: 'payment',
    date: p.created_at,
    amount: p.amount,
    token: p.token,
    chain: p.chain,
    status: p.status,
    description: p.direction === 'received'
      ? `Received from ${(p.from_address ?? p.to_address).slice(0, 8)}…`
      : `Sent to ${p.to_address.slice(0, 8)}…`,
  }));
}

function mapSwaps(swaps: Swap[]): UnifiedRow[] {
  return swaps.map((s) => ({
    id: `swap-${s.id}`,
    type: 'swap',
    date: s.created_at,
    amount: s.from_amount,
    token: s.from_token,
    chain: s.chain,
    status: s.status,
    description: `${s.from_token} → ${s.to_token}`,
  }));
}

function mapRamps(ramps: FiatTransaction[]): UnifiedRow[] {
  return ramps.map((r) => ({
    id: `ramp-${r.id}`,
    type: 'ramp',
    date: r.created_at,
    amount: r.crypto_amount,
    token: r.crypto_token,
    chain: null,
    status: r.status,
    description: r.direction === 'onramp' ? 'On-ramp (fiat→crypto)' : 'Off-ramp (crypto→fiat)',
  }));
}

function mapOnchain(txs: Transaction[]): UnifiedRow[] {
  return txs.map((t) => ({
    id: `onchain-${t.id}`,
    type: 'onchain',
    date: t.timestamp,
    amount: t.amount ?? '0',
    token: t.token ?? '—',
    chain: t.chain,
    status: t.status,
    description: t.direction === 'inbound'
      ? `From ${t.from_address.slice(0, 8)}…`
      : `To ${t.to_address.slice(0, 8)}…`,
  }));
}

function mapYield(txs: YieldTransaction[]): UnifiedRow[] {
  return txs.map((y) => ({
    id: `yield-${y.id}`,
    type: 'yield',
    date: y.executed_at ?? y.created_at,
    amount: y.amount,
    token: y.underlying_token,
    chain: y.chain,
    status: y.status,
    description: y.tx_type === 'deposit'
      ? `Deposit into ${y.protocol}`
      : `Withdraw from ${y.protocol}`,
  }));
}

const TYPE_BADGE: Record<UnifiedRow['type'], string> = {
  payment: 'bg-[#19595b]/10 text-[#134849] dark:bg-[#19595b]/25 dark:text-teal-300',
  swap: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  ramp: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  onchain: 'bg-white border text-gray-600 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300',
  yield: 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-300',
};

const ALL_EXPORT_COLUMNS: ExportColumn<UnifiedRow>[] = [
  { header: 'Type', accessor: (r) => capitalize(r.type) },
  { header: 'Description', accessor: (r) => r.description },
  { header: 'Amount', accessor: (r) => formatCurrency(r.amount) },
  { header: 'Token', accessor: (r) => r.token },
  { header: 'Chain', accessor: (r) => r.chain ? capitalize(r.chain) : '' },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
  { header: 'Date', accessor: (r) => formatDateTime(r.date) },
];

const ALL_FILTER_CONFIG = {
  searchFields: [
    'description' as const,
    'token' as const,
    'type' as const,
  ],
  dropdowns: [
    { key: 'type', accessor: (item: UnifiedRow) => item.type },
    { key: 'status', accessor: (item: UnifiedRow) => item.status },
    { key: 'chain', accessor: (item: UnifiedRow) => item.chain ?? 'None' },
  ],
  dateField: (item: UnifiedRow) => item.date,
};

export function AllTab() {
  const { data, isLoading } = useQuery<UnifiedRow[]>({
    queryKey: ['unified-transactions'],
    queryFn: async () => {
      const [p, s, r, t, y] = await Promise.allSettled([
        fetch('/api/payments').then((res) => res.json()),
        fetch('/api/swaps').then((res) => res.json()),
        fetch('/api/ramps').then((res) => res.json()),
        fetch('/api/transactions?limit=100').then((res) => res.json()),
        fetch('/api/yield/transactions').then((res) => res.json()),
      ]);

      const payments: Payment[] = p.status === 'fulfilled' ? (p.value.data ?? []) : [];
      const swaps: Swap[] = s.status === 'fulfilled' ? (s.value.data ?? []) : [];
      const ramps: FiatTransaction[] = r.status === 'fulfilled' ? (r.value.data ?? []) : [];
      const onchain: Transaction[] = t.status === 'fulfilled' ? (t.value.data ?? []) : [];
      const yieldTxs: YieldTransaction[] = y.status === 'fulfilled' ? (y.value.data ?? []) : [];

      const all: UnifiedRow[] = [
        ...mapPayments(payments),
        ...mapSwaps(swaps),
        ...mapRamps(ramps),
        ...mapOnchain(onchain),
        ...mapYield(yieldTxs),
      ];

      return all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, ALL_FILTER_CONFIG);

  return (
    <Card>
      <CardHeader><CardTitle>All Activity</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search transactions..."
          dropdowns={[
            { key: 'type', label: 'Type', options: filter.dropdownOptions.type ?? [] },
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
          onExportCsv={() => exportCsv('transactions', ALL_EXPORT_COLUMNS, filter.filteredData)}
          onExportPdf={() => exportPdf('transactions', 'All Transactions', ALL_EXPORT_COLUMNS, filter.filteredData)}
        />
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <CardSpinner />
                </TableCell>
              </TableRow>
            ) : filter.pagedData.length ? (
              filter.pagedData.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold border ${TYPE_BADGE[row.type]}`}>
                      {capitalize(row.type)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.description}</TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(row.amount)}</span>
                  </TableCell>
                  <TableCell>
                    {row.token !== '—' ? <Badge variant="outline">{row.token}</Badge> : '—'}
                  </TableCell>
                  <TableCell>
                    {row.chain ? <Badge variant={row.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(row.chain)}</Badge> : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      row.status === 'completed' ? 'success' as any :
                      row.status === 'failed' ? 'destructive' :
                      'warning' as any
                    }>
                      {capitalize(row.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(row.date)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {filter.activeFilterCount > 0 ? 'No matching transactions.' : 'No activity yet.'}
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
  );
}
