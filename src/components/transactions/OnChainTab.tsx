'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, truncateAddress, capitalize } from '@/lib/utils';
import type { Transaction } from '@/types/database';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';

const ONCHAIN_FILTER_CONFIG = {
  searchFields: [
    'tx_hash' as const,
    'from_address' as const,
    'to_address' as const,
    (item: Transaction) => item.token ?? '',
  ],
  dropdowns: [
    { key: 'direction', accessor: (item: Transaction) => item.direction },
    { key: 'chain', accessor: (item: Transaction) => item.chain },
    { key: 'status', accessor: (item: Transaction) => item.status },
  ],
  dateField: (item: Transaction) => item.timestamp,
};

export function OnChainTab() {
  const { data, isLoading } = useQuery<Transaction[]>({
    queryKey: ['transactions'],
    queryFn: async () => {
      const res = await fetch('/api/transactions?limit=100');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, ONCHAIN_FILTER_CONFIG);

  return (
    <Card>
      <CardHeader><CardTitle>On-Chain Transactions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search transactions..."
          dropdowns={[
            { key: 'direction', label: 'Direction', options: filter.dropdownOptions.direction ?? [] },
            { key: 'chain', label: 'Chain', options: filter.dropdownOptions.chain ?? [] },
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
        />
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dir</TableHead>
              <TableHead>TX Hash</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Chain</TableHead>
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
                    {tx.direction === 'inbound' ? (
                      <ArrowDownLeft className="h-4 w-4 text-green-500" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-red-500" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateAddress(tx.tx_hash, 8)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateAddress(tx.from_address, 6)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateAddress(tx.to_address, 6)}
                  </TableCell>
                  <TableCell>
                    {tx.amount ? (
                      <span className="font-semibold">{formatCurrency(tx.amount)}</span>
                    ) : '—'}
                    {tx.token && <Badge variant="outline" className="ml-1">{tx.token}</Badge>}
                  </TableCell>
                  <TableCell><Badge variant={tx.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(tx.chain)}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(tx.timestamp)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {filter.activeFilterCount > 0 ? 'No matching transactions.' : 'No transactions recorded yet.'}
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
