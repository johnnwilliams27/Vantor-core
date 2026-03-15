'use client';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, capitalize } from '@/lib/utils';
import type { Swap } from '@/types/database';

const FILTER_CONFIG = {
  searchFields: ['from_token' as const, 'to_token' as const],
  dropdowns: [
    { key: 'status', accessor: (item: Swap) => item.status },
    { key: 'chain', accessor: (item: Swap) => item.chain },
  ],
};

export function SwapsSection({ data }: { data: Swap[] }) {
  const filter = useTableFilter(data, FILTER_CONFIG);

  const summary = useMemo(() => {
    const pairs: Record<string, number> = {};
    let totalVolume = 0;
    for (const s of data) {
      const pair = `${s.from_token}→${s.to_token}`;
      pairs[pair] = (pairs[pair] ?? 0) + 1;
      totalVolume += parseFloat(s.from_amount);
    }
    return { pairs, totalVolume, count: data.length };
  }, [data]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Swaps ({data.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Total Volume</div>
            <div className="text-sm font-bold">{formatCurrency(String(summary.totalVolume))}</div>
          </div>
          {Object.entries(summary.pairs).map(([pair, count]) => (
            <div key={pair} className="rounded-lg border bg-muted/30 px-3 py-2">
              <div className="text-xs text-muted-foreground">{pair}</div>
              <div className="text-sm font-bold">{count} swap{count !== 1 ? 's' : ''}</div>
            </div>
          ))}
        </div>

        <FilterBar
          search={filter.search} onSearchChange={filter.setSearch} searchPlaceholder="Search swaps..."
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
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">From</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">To</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Chain</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {filter.pagedData.map((s, i) => (
                <tr key={s.id} className={`border-b ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  <td className="px-3 py-2 font-mono">{s.created_at.split('T')[0]}</td>
                  <td className="px-3 py-2">{formatCurrency(s.from_amount)} {s.from_token}</td>
                  <td className="px-3 py-2">{formatCurrency(s.to_amount ?? s.from_amount)} {s.to_token}</td>
                  <td className="px-3 py-2 capitalize">{s.chain}</td>
                  <td className="px-3 py-2 capitalize">{s.status}</td>
                </tr>
              ))}
              {!filter.pagedData.length && (
                <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No swaps found.</td></tr>
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
