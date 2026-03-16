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
import type { BridgeTransfer } from '@/types/database';
import { CardSpinner } from '@/components/ui/spinner';
import { ArrowRight } from 'lucide-react';

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

const BRIDGE_FILTER_CONFIG = {
  searchFields: [
    'token' as const,
    'provider' as const,
  ],
  dropdowns: [
    { key: 'status', accessor: (item: BridgeTransfer) => item.status },
    { key: 'provider', accessor: (item: BridgeTransfer) => item.provider },
    { key: 'token', accessor: (item: BridgeTransfer) => item.token },
  ],
  dateField: (item: BridgeTransfer) => item.executed_at ?? item.created_at,
};

export function BridgeHistory() {
  const { data, isLoading } = useQuery<BridgeTransfer[]>({
    queryKey: ['bridge-transfers'],
    queryFn: async () => {
      const res = await fetch('/api/bridges');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, BRIDGE_FILTER_CONFIG);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Bridge History</CardTitle></CardHeader>
        <CardContent><CardSpinner /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Bridge History</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search bridges..."
          dropdowns={[
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
            { key: 'provider', label: 'Provider', options: filter.dropdownOptions.provider ?? [] },
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
          onExportCsv={() => exportCsv('bridge-history', BRIDGE_EXPORT_COLUMNS, filter.filteredData)}
          onExportPdf={() => exportPdf('bridge-history', 'Bridge History', BRIDGE_EXPORT_COLUMNS, filter.filteredData, 'landscape')}
        />
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Token</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
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
                    <TableCell className="text-sm text-muted-foreground">{b.bridge_fee} {b.token}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {PROVIDER_LABELS[b.provider] ?? b.provider}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        b.status === 'completed' ? 'success' as any :
                        b.status === 'failed' ? 'destructive' :
                        'warning' as any
                      }>
                        {capitalize(b.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDateTime(b.executed_at ?? b.created_at)}
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
  );
}
