'use client';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatDateTime, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { FiatTransaction } from '@/types/database';
import { ArrowDownLeft, ArrowUpRight, History } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';

async function fetchFiatTransactions(): Promise<FiatTransaction[]> {
  const res = await fetch('/api/ramps');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data;
}

function StatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
    completed: 'success',
    pending: 'warning',
    payment_submitted: 'warning',
    failed: 'destructive',
  };
  return <Badge variant={variantMap[status] ?? 'secondary'}>{capitalize(status)}</Badge>;
}

function DirectionBadge({ direction }: { direction: 'onramp' | 'offramp' }) {
  if (direction === 'onramp') {
    return (
      <Badge variant="onramp" className="gap-1">
        <ArrowDownLeft className="h-3 w-3 shrink-0" />
        On-ramp
      </Badge>
    );
  }
  return (
    <Badge variant="offramp" className="gap-1">
      <ArrowUpRight className="h-3 w-3 shrink-0" />
      Off-ramp
    </Badge>
  );
}

const RAMP_EXPORT_COLUMNS: ExportColumn<FiatTransaction>[] = [
  { header: 'Direction', accessor: (r) => capitalize(r.direction) },
  { header: 'Crypto Amount', accessor: (r) => parseFloat(r.crypto_amount).toLocaleString() },
  { header: 'Crypto Token', accessor: (r) => r.crypto_token },
  { header: 'Fiat Amount', accessor: (r) => parseFloat(r.fiat_amount).toLocaleString() },
  { header: 'Fiat Currency', accessor: (r) => r.fiat_currency },
  { header: 'Rate', accessor: (r) => r.exchange_rate ? parseFloat(r.exchange_rate).toFixed(4) : '' },
  { header: 'Fee', accessor: (r) => r.fee_amount ? parseFloat(r.fee_amount).toLocaleString() : '' },
  { header: 'Bank', accessor: (r) => r.bank_account?.institution_name ?? '' },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
  { header: 'Date', accessor: (r) => formatDateTime(r.created_at) },
];

const RAMP_FILTER_CONFIG = {
  searchFields: [
    'crypto_token' as const,
    (item: FiatTransaction) => item.bank_account?.institution_name ?? '',
    (item: FiatTransaction) => item.bank_account?.nickname ?? '',
  ],
  dropdowns: [
    { key: 'direction', accessor: (item: FiatTransaction) => item.direction },
    { key: 'status', accessor: (item: FiatTransaction) => item.status },
  ],
  dateField: (item: FiatTransaction) => item.created_at,
};

export function FiatTransactionTable() {
  const { data: txs, isLoading, error } = useQuery({
    queryKey: ['fiat-transactions'],
    queryFn: fetchFiatTransactions,
  });

  const filter = useTableFilter(txs, RAMP_FILTER_CONFIG);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" />
          Ramp History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <CardSpinner />
        ) : error ? (
          <div className="text-sm text-red-500 py-4">{(error as Error).message}</div>
        ) : !txs?.length ? (
          <div className="text-sm text-gray-400 text-center py-8">
            No ramp transactions yet. Use the form above to get started.
          </div>
        ) : (
          <div className="space-y-4">
          <FilterBar
            search={filter.search}
            onSearchChange={filter.setSearch}
            searchPlaceholder="Search ramps..."
            dropdowns={[
              { key: 'direction', label: 'Direction', options: filter.dropdownOptions.direction ?? [] },
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
            onExportCsv={() => exportCsv('ramp-transactions', RAMP_EXPORT_COLUMNS, filter.filteredData)}
            onExportPdf={() => exportPdf('ramp-transactions', 'Ramp History', RAMP_EXPORT_COLUMNS, filter.filteredData, 'landscape')}
          />
          {!filter.filteredData.length ? (
            <div className="text-sm text-gray-400 text-center py-8">
              No matching transactions.
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-sm font-medium">
                  <th className="text-left py-2 pr-4">Direction</th>
                  <th className="text-right py-2 pr-4">Crypto</th>
                  <th className="text-right py-2 pr-4">Fiat</th>
                  <th className="text-right py-2 pr-4">Rate</th>
                  <th className="text-right py-2 pr-4">Fee</th>
                  <th className="text-left py-2 pr-4">Bank</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {filter.pagedData.map((tx) => (
                  <tr key={tx.id} className="border-b last:border-0 hover:bg-gray-50/50">
                    <td className="py-2 pr-4">
                      <DirectionBadge direction={tx.direction} />
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {parseFloat(tx.crypto_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {tx.crypto_token}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {parseFloat(tx.fiat_amount).toLocaleString(undefined, { style: 'currency', currency: tx.fiat_currency })}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-500">
                      {tx.exchange_rate ? parseFloat(tx.exchange_rate).toFixed(4) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-500">
                      {tx.fee_amount
                        ? parseFloat(tx.fee_amount).toLocaleString(undefined, { style: 'currency', currency: tx.fiat_currency })
                        : '—'}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">
                      {tx.bank_account
                        ? `${tx.bank_account.nickname ? `${tx.bank_account.nickname} – ` : ''}${tx.bank_account.institution_name}${tx.bank_account.last4 ? ` ****${tx.bank_account.last4}` : ''}`
                        : '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={tx.status} />
                    </td>
                    <td className="py-2 text-gray-400 whitespace-nowrap">
                      {formatDateTime(tx.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          <TablePagination
            page={filter.page}
            totalPages={filter.totalPages}
            pageSize={filter.pageSize}
            filteredCount={filter.filteredCount}
            onPageChange={filter.setPage}
            onPageSizeChange={filter.setPageSize}
          />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
