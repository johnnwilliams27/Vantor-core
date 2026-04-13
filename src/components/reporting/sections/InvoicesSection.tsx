'use client';
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import type { Invoice } from '@/types/database';

const FILTER_CONFIG = {
  searchFields: [
    'invoice_number' as const,
    (item: Invoice) => item.vendor?.name ?? '',
  ],
  dropdowns: [
    { key: 'status', accessor: (item: Invoice) => item.status },
    { key: 'currency', accessor: (item: Invoice) => item.currency ?? item.token ?? '' },
  ],
};

function agingBucket(dueDate: string | null): string {
  if (!dueDate) return 'No date';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  const days = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Not due';
  if (days <= 30) return '1–30 days';
  if (days <= 60) return '31–60 days';
  if (days <= 90) return '61–90 days';
  return '90+ days';
}

export function InvoicesSection({ data }: { data: Invoice[] }) {
  const filter = useTableFilter(data, FILTER_CONFIG);

  const summary = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const aging: Record<string, number> = {};
    let totalOutstanding = 0;
    for (const inv of data) {
      byStatus[inv.status] = (byStatus[inv.status] ?? 0) + 1;
      if (inv.status !== 'paid' && inv.status !== 'cancelled') {
        totalOutstanding += parseFloat(inv.amount);
        const bucket = agingBucket(inv.due_date);
        aging[bucket] = (aging[bucket] ?? 0) + 1;
      }
    }
    return { byStatus, aging, totalOutstanding, count: data.length };
  }, [data]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Invoices ({data.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Outstanding</div>
            <div className="text-sm font-bold tabular-nums">{formatCurrency(String(summary.totalOutstanding))}</div>
          </div>
          {Object.entries(summary.byStatus).map(([status, count]) => (
            <div key={status} className="rounded-lg border bg-muted/30 px-3 py-2">
              <div className="text-xs text-muted-foreground capitalize">{status}</div>
              <div className="text-sm font-bold">{count}</div>
            </div>
          ))}
        </div>

        {Object.keys(summary.aging).length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2">Aging (Unpaid/Overdue)</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.aging).map(([bucket, count]) => (
                <div key={bucket} className="rounded-md border px-2.5 py-1 text-xs">
                  <span className="text-muted-foreground">{bucket}:</span>{' '}
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <FilterBar
          search={filter.search} onSearchChange={filter.setSearch} searchPlaceholder="Search invoices..."
          dropdowns={[
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
            { key: 'token', label: 'Token', options: filter.dropdownOptions.token ?? [] },
          ]}
          filters={filter.filters} onFilterChange={filter.setFilter}
          resultCount={filter.filteredData.length} totalCount={filter.totalCount}
          activeFilterCount={filter.activeFilterCount} onClear={filter.clearAll}
        />

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice #</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Vendor</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Token</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Due Date</th>
              </tr>
            </thead>
            <tbody>
              {filter.pagedData.map((inv, i) => (
                <tr key={inv.id} className={`border-b ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                  <td className="px-3 py-2 font-mono">{inv.invoice_number}</td>
                  <td className="px-3 py-2">{inv.vendor?.name ?? '—'}</td>
                  <td className="px-3 py-2 font-semibold tabular-nums">{formatCurrency(inv.amount)}</td>
                  <td className="px-3 py-2">{inv.token}</td>
                  <td className="px-3 py-2 capitalize">{inv.status}</td>
                  <td className="px-3 py-2">{inv.due_date ? formatDateTime(inv.due_date) : '—'}</td>
                </tr>
              ))}
              {!filter.pagedData.length && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-6">No invoices found.</td></tr>
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
