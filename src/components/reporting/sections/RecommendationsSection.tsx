'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import type { AiRecommendation } from '@/types/database';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const FILTER_CONFIG = {
  searchFields: ['action' as const, 'ai_reasoning' as const],
  dropdowns: [
    { key: 'status', accessor: (item: AiRecommendation) => item.status },
    { key: 'action', accessor: (item: AiRecommendation) => item.action },
  ],
};

export function RecommendationsSection({ data }: { data: AiRecommendation[] }) {
  const filter = useTableFilter(data, FILTER_CONFIG);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">AI Recommendation Outcomes ({data.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search recommendations..."
          dropdowns={[
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
            { key: 'action', label: 'Action', options: filter.dropdownOptions.action ?? [] },
          ]}
          filters={filter.filters}
          onFilterChange={filter.setFilter}
          resultCount={filter.filteredData.length}
          totalCount={filter.totalCount}
          activeFilterCount={filter.activeFilterCount}
          onClear={filter.clearAll}
        />
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Action</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {filter.pagedData.map((rec, i) => (
                <tr key={rec.id} className={`border-b ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  <td className="px-3 py-2 font-mono">{rec.created_at.split('T')[0]}</td>
                  <td className="px-3 py-2 capitalize">{rec.action}</td>
                  <td className="px-3 py-2">{rec.recommended_amount_usd ? fmt(parseFloat(rec.recommended_amount_usd)) : '—'}</td>
                  <td className="px-3 py-2 capitalize">{rec.status.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">{rec.ai_reasoning.slice(0, 80)}</td>
                </tr>
              ))}
              {!filter.pagedData.length && (
                <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No recommendations found.</td></tr>
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
