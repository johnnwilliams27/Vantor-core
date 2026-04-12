'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatDateTime, capitalize } from '@/lib/utils';
import type { FiatTransaction } from '@/types/database';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const FILTER_CONFIG = {
  searchFields: [
    (item: FiatTransaction) => item.crypto_token ?? '',
    (item: FiatTransaction) => item.provider ?? '',
  ],
  dropdowns: [
    { key: 'direction', accessor: (item: FiatTransaction) => item.direction },
    { key: 'status', accessor: (item: FiatTransaction) => item.status },
  ],
};

export function RampHistorySection({ data }: { data: FiatTransaction[] }) {
  const filter = useTableFilter(data, FILTER_CONFIG);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Ramp History ({data.length})</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <FilterBar
          search={filter.search} onSearchChange={filter.setSearch} searchPlaceholder="Search ramps..."
          dropdowns={[
            { key: 'direction', label: 'Direction', options: filter.dropdownOptions.direction ?? [] },
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
          ]}
          filters={filter.filters} onFilterChange={filter.setFilter}
          resultCount={filter.filteredData.length} totalCount={filter.totalCount}
          activeFilterCount={filter.activeFilterCount} onClear={filter.clearAll}
        />
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Direction</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Bank Amount</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Currency</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Token</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Provider</th>
              </tr>
            </thead>
            <tbody>
              {filter.pagedData.map((ramp, i) => (
                <tr key={ramp.id} className={`border-b ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  <td className="px-3 py-2 font-mono">{ramp.created_at.split('T')[0]}</td>
                  <td className="px-3 py-2 capitalize">{ramp.direction}</td>
                  <td className="px-3 py-2">{fmt(parseFloat(ramp.fiat_amount))}</td>
                  <td className="px-3 py-2">{ramp.fiat_currency}</td>
                  <td className="px-3 py-2">{ramp.crypto_token}</td>
                  <td className="px-3 py-2 capitalize">{ramp.status}</td>
                  <td className="px-3 py-2">{ramp.provider}</td>
                </tr>
              ))}
              {!filter.pagedData.length && (
                <tr><td colSpan={7} className="text-center text-muted-foreground py-6">No ramp transactions found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={filter.page} totalPages={filter.totalPages} pageSize={filter.pageSize}
          filteredCount={filter.filteredCount} onPageChange={filter.setPage} onPageSizeChange={filter.setPageSize}
        />
      </CardContent>
    </Card>
  );
}
