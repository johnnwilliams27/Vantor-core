'use client';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, truncateAddress, capitalize } from '@/lib/utils';
import type { Transfer } from '@/types/database';

const FILTER_CONFIG = {
  searchFields: ['to_address' as const, 'token' as const, 'memo' as const],
  dropdowns: [
    { key: 'status', accessor: (item: Transfer) => item.status },
    { key: 'chain', accessor: (item: Transfer) => item.chain },
  ],
};

export function TransfersSection({ data }: { data: Transfer[] }) {
  const filter = useTableFilter(data, FILTER_CONFIG);

  const summary = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let totalVolume = 0;
    for (const p of data) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      totalVolume += parseFloat(p.amount);
    }
    return { byStatus, totalVolume, count: data.length };
  }, [data]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Transfers ({data.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Total Volume</div>
            <div className="text-sm font-bold">{formatCurrency(String(summary.totalVolume))}</div>
          </div>
          {Object.entries(summary.byStatus).map(([status, count]) => (
            <div key={status} className="rounded-lg border bg-muted/30 px-3 py-2">
              <div className="text-xs text-muted-foreground capitalize">{status}</div>
              <div className="text-sm font-bold">{count}</div>
            </div>
          ))}
        </div>

        <FilterBar
          search={filter.search} onSearchChange={filter.setSearch} searchPlaceholder="Search transfers..."
          dropdowns={[
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
            { key: 'chain', label: 'Chain', options: filter.dropdownOptions.chain ?? [] },
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
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">To</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Token</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Chain</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {filter.pagedData.map((p, i) => (
                <tr key={p.id} className={`border-b ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  <td className="px-3 py-2 font-mono">{p.created_at.split('T')[0]}</td>
                  <td className="px-3 py-2 font-mono">{truncateAddress(p.to_address, 6)}</td>
                  <td className="px-3 py-2 font-semibold">{formatCurrency(p.amount)}</td>
                  <td className="px-3 py-2">{p.token}</td>
                  <td className="px-3 py-2 capitalize">{p.chain}</td>
                  <td className="px-3 py-2 capitalize">{p.status}</td>
                </tr>
              ))}
              {!filter.pagedData.length && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-6">No transfers found.</td></tr>
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
