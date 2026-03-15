'use client';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, capitalize } from '@/lib/utils';
import type { YieldTransaction } from '@/types/database';

const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: 'Aave V3',
  morpho: 'Morpho',
  kamino: 'Kamino',
  ondo: 'Ondo (USDY)',
};

const FILTER_CONFIG = {
  searchFields: ['protocol' as const, 'underlying_token' as const],
  dropdowns: [
    { key: 'tx_type', accessor: (item: YieldTransaction) => item.tx_type },
    { key: 'protocol', accessor: (item: YieldTransaction) => item.protocol },
    { key: 'status', accessor: (item: YieldTransaction) => item.status },
  ],
};

export function YieldSection({ data }: { data: YieldTransaction[] }) {
  const filter = useTableFilter(data, FILTER_CONFIG);

  const summary = useMemo(() => {
    let totalDeposited = 0;
    let totalWithdrawn = 0;
    const byProtocol: Record<string, number> = {};
    for (const tx of data) {
      const amt = parseFloat(tx.amount);
      if (tx.tx_type === 'deposit') totalDeposited += amt;
      else totalWithdrawn += amt;
      byProtocol[tx.protocol] = (byProtocol[tx.protocol] ?? 0) + 1;
    }
    return { totalDeposited, totalWithdrawn, byProtocol, count: data.length };
  }, [data]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Yield Activity ({data.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Total Deposited</div>
            <div className="text-sm font-bold">{formatCurrency(String(summary.totalDeposited))}</div>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Total Withdrawn</div>
            <div className="text-sm font-bold">{formatCurrency(String(summary.totalWithdrawn))}</div>
          </div>
          {Object.entries(summary.byProtocol).map(([protocol, count]) => (
            <div key={protocol} className="rounded-lg border bg-muted/30 px-3 py-2">
              <div className="text-xs text-muted-foreground">{PROTOCOL_LABELS[protocol] ?? protocol}</div>
              <div className="text-sm font-bold">{count} tx{count !== 1 ? 's' : ''}</div>
            </div>
          ))}
        </div>

        <FilterBar
          search={filter.search} onSearchChange={filter.setSearch} searchPlaceholder="Search yield..."
          dropdowns={[
            { key: 'tx_type', label: 'Type', options: filter.dropdownOptions.tx_type ?? [] },
            { key: 'protocol', label: 'Protocol', options: filter.dropdownOptions.protocol ?? [] },
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
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Protocol</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Token</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Chain</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {filter.pagedData.map((tx, i) => (
                <tr key={tx.id} className={`border-b ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  <td className="px-3 py-2 font-mono">{(tx.executed_at ?? tx.created_at).split('T')[0]}</td>
                  <td className="px-3 py-2 capitalize">{tx.tx_type}</td>
                  <td className="px-3 py-2">{PROTOCOL_LABELS[tx.protocol] ?? tx.protocol}</td>
                  <td className="px-3 py-2 font-semibold">{formatCurrency(tx.amount)}</td>
                  <td className="px-3 py-2">{tx.underlying_token}</td>
                  <td className="px-3 py-2 capitalize">{tx.chain}</td>
                  <td className="px-3 py-2 capitalize">{tx.status}</td>
                </tr>
              ))}
              {!filter.pagedData.length && (
                <tr><td colSpan={7} className="text-center text-muted-foreground py-6">No yield transactions found.</td></tr>
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
