'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ChainBadge } from '@/components/ui/icons/chain-logos';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, truncateAddress, capitalize } from '@/lib/utils';
import type { Transfer } from '@/types/database';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { TableRowsSkeleton } from '@/components/ui/operations-skeletons';

function DirectionCell({ transfer }: { transfer: Transfer }) {
  if (transfer.direction === 'received') {
    return (
      <div className="flex items-center gap-1.5 text-green-700">
        <ArrowDownLeft className="h-4 w-4 shrink-0" />
        <span className="text-xs font-semibold">Received</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-red-600">
      <ArrowUpRight className="h-4 w-4 shrink-0" />
      <span className="text-xs font-semibold">Sent</span>
    </div>
  );
}

function CounterpartyCell({ transfer }: { transfer: Transfer }) {
  if (transfer.direction === 'received') {
    const addr = transfer.from_address ?? transfer.from_wallet?.address ?? '—';
    return (
      <div>
        <div className="text-xs text-gray-400 mb-0.5">From</div>
        <span className="font-mono text-xs">{addr === '—' ? '—' : truncateAddress(addr, 8)}</span>
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs text-gray-400 mb-0.5">To</div>
      <span className="font-mono text-xs">{truncateAddress(transfer.to_address, 8)}</span>
    </div>
  );
}

const TRANSFERS_TAB_FILTER_CONFIG = {
  searchFields: [
    'to_address' as const,
    'token' as const,
    'memo' as const,
  ],
  dropdowns: [
    { key: 'status', accessor: (item: Transfer) => item.status },
    { key: 'chain', accessor: (item: Transfer) => item.chain },
  ],
  dateField: (item: Transfer) => item.created_at,
};

export function TransfersTab() {
  const { data, isLoading } = useQuery<Transfer[]>({
    queryKey: ['transfers'],
    queryFn: async () => {
      const res = await fetch('/api/transfers');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, TRANSFERS_TAB_FILTER_CONFIG);

  return (
    <Card>
      <CardHeader><CardTitle>Transfers</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search transfers..."
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
        />
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Direction</TableHead>
              <TableHead>Counterparty</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRowsSkeleton columns={6} rows={5} />
            ) : filter.pagedData.length ? (
              filter.pagedData.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><DirectionCell transfer={p} /></TableCell>
                  <TableCell><CounterpartyCell transfer={p} /></TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(p.amount)}</span>{' '}
                    <Badge variant="outline">{p.token}</Badge>
                  </TableCell>
                  <TableCell><ChainBadge chain={p.chain} /></TableCell>
                  <TableCell>
                    <Badge variant={
                      p.status === 'completed' ? 'success' as any :
                      p.status === 'failed' ? 'destructive' :
                      'warning' as any
                    }>
                      {capitalize(p.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(p.created_at)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
  );
}
