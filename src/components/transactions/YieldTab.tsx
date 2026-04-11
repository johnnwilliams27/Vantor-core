'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import type { YieldTransaction } from '@/types/database';
import { CardSpinner } from '@/components/ui/spinner';
import { getVenueDisplayName } from '@/lib/yield/venues';

const YIELD_FILTER_CONFIG = {
  searchFields: [
    'protocol' as const,
    'underlying_token' as const,
  ],
  dropdowns: [
    { key: 'tx_type', accessor: (item: YieldTransaction) => item.tx_type },
    { key: 'protocol', accessor: (item: YieldTransaction) => item.protocol },
    { key: 'status', accessor: (item: YieldTransaction) => item.status },
    { key: 'chain', accessor: (item: YieldTransaction) => item.chain },
  ],
  dateField: (item: YieldTransaction) => item.executed_at ?? item.created_at,
};

export function YieldTab() {
  const { data, isLoading } = useQuery<YieldTransaction[]>({
    queryKey: ['yield-transactions'],
    queryFn: async () => {
      const res = await fetch('/api/yield/transactions');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, YIELD_FILTER_CONFIG);

  return (
    <Card>
      <CardHeader><CardTitle>Yield Transactions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search yield..."
          dropdowns={[
            { key: 'tx_type', label: 'Type', options: filter.dropdownOptions.tx_type ?? [] },
            { key: 'protocol', label: 'Protocol', options: filter.dropdownOptions.protocol ?? [] },
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
              <TableHead>Type</TableHead>
              <TableHead>Protocol</TableHead>
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
              filter.pagedData.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>
                    <Badge variant={tx.tx_type === 'deposit' ? 'onramp' : 'offramp'}>
                      {capitalize(tx.tx_type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{getVenueDisplayName(tx.protocol)}</TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(tx.amount)}</span>
                  </TableCell>
                  <TableCell><Badge variant="outline">{tx.underlying_token}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={tx.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(tx.chain)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      tx.status === 'completed' ? 'success' as any :
                      tx.status === 'failed' ? 'destructive' :
                      'warning' as any
                    }>
                      {capitalize(tx.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(tx.executed_at ?? tx.created_at)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {filter.activeFilterCount > 0 ? 'No matching transactions.' : 'No yield transactions yet.'}
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
