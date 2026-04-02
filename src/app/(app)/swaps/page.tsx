'use client';
import { SwapForm } from '@/components/swaps/SwapForm';
import { ScheduleSwapForm } from '@/components/scheduled/ScheduleSwapForm';
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
import type { Swap } from '@/types/database';
import { CardSpinner } from '@/components/ui/spinner';

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
    { key: 'status', accessor: (item: Swap) => item.status },
    { key: 'chain', accessor: (item: Swap) => item.chain },
  ],
  dateField: (item: Swap) => item.created_at,
};

function SwapHistory() {
  const { data, isLoading } = useQuery<Swap[]>({
    queryKey: ['swaps'],
    queryFn: async () => {
      const res = await fetch('/api/swaps');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, SWAP_FILTER_CONFIG);

  if (isLoading) {
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
          onExportCsv={() => exportCsv('swaps', SWAP_EXPORT_COLUMNS, filter.filteredData)}
          onExportPdf={() => exportPdf('swaps', 'Swap History', SWAP_EXPORT_COLUMNS, filter.filteredData)}
        />
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filter.pagedData.length ? (
              filter.pagedData.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(s.from_amount)}</span>{' '}
                    <Badge variant="outline">{s.from_token}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(s.to_amount ?? s.from_amount)}</span>{' '}
                    <Badge variant="outline">{s.to_token}</Badge>
                    {!s.to_amount && <span className="text-xs text-muted-foreground ml-1">(est.)</span>}
                  </TableCell>
                  <TableCell><Badge variant={s.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(s.chain)}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={
                      s.status === 'completed' ? 'success' as any :
                      s.status === 'failed' ? 'destructive' :
                      'warning' as any
                    }>
                      {capitalize(s.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(s.created_at)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
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
