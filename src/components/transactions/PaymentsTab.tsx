'use client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, truncateAddress, capitalize } from '@/lib/utils';
import type { Payment } from '@/types/database';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';

function DirectionCell({ payment }: { payment: Payment }) {
  if (payment.direction === 'received') {
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

function CounterpartyCell({ payment }: { payment: Payment }) {
  if (payment.direction === 'received') {
    const addr = payment.from_address ?? payment.from_wallet?.address ?? '—';
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
      <span className="font-mono text-xs">{truncateAddress(payment.to_address, 8)}</span>
    </div>
  );
}

const PAYMENTS_TAB_FILTER_CONFIG = {
  searchFields: [
    'to_address' as const,
    'token' as const,
    'memo' as const,
  ],
  dropdowns: [
    { key: 'status', accessor: (item: Payment) => item.status },
    { key: 'chain', accessor: (item: Payment) => item.chain },
  ],
  dateField: (item: Payment) => item.created_at,
};

export function PaymentsTab() {
  const { data, isLoading } = useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: async () => {
      const res = await fetch('/api/payments');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, PAYMENTS_TAB_FILTER_CONFIG);

  return (
    <Card>
      <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search payments..."
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
              <TableRow>
                <TableCell colSpan={6}>
                  <CardSpinner />
                </TableCell>
              </TableRow>
            ) : filter.pagedData.length ? (
              filter.pagedData.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><DirectionCell payment={p} /></TableCell>
                  <TableCell><CounterpartyCell payment={p} /></TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(p.amount)}</span>{' '}
                    <Badge variant="outline">{p.token}</Badge>
                  </TableCell>
                  <TableCell><Badge variant={p.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(p.chain)}</Badge></TableCell>
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
                  {filter.activeFilterCount > 0 ? 'No matching payments.' : 'No payments yet.'}
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
