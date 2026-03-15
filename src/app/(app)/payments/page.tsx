'use client';
import { SendPaymentForm } from '@/components/payments/SendPaymentForm';
import { SchedulePaymentForm } from '@/components/payments/SchedulePaymentForm';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, truncateAddress, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import type { Payment } from '@/types/database';
import { CardSpinner } from '@/components/ui/spinner';

const STATUS_COLORS: Record<string, string> = {
  pending: 'warning',
  processing: 'info',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'secondary',
};

const PAYMENT_FILTER_CONFIG = {
  searchFields: [
    'to_address' as const,
    'token' as const,
    'memo' as const,
  ],
  dropdowns: [
    { key: 'status', accessor: (item: Payment) => item.status },
    { key: 'token', accessor: (item: Payment) => item.token },
    { key: 'chain', accessor: (item: Payment) => item.chain },
    { key: 'erp', accessor: (item: Payment) => item.erp_config?.provider?.toUpperCase() ?? 'None' },
  ],
  dateField: (item: Payment) => item.created_at,
};

const EXPORT_COLUMNS: ExportColumn<Payment>[] = [
  { header: 'To', accessor: (r) => truncateAddress(r.to_address, 6) },
  { header: 'Amount', accessor: (r) => formatCurrency(r.amount) },
  { header: 'Token', accessor: (r) => r.token },
  { header: 'Chain', accessor: (r) => capitalize(r.chain) },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
  { header: 'ERP', accessor: (r) => r.erp_config?.provider?.toUpperCase() ?? 'None' },
  { header: 'Scheduled', accessor: (r) => r.scheduled_for ? formatDateTime(r.scheduled_for) : 'Immediate' },
  { header: 'Date', accessor: (r) => formatDateTime(r.created_at) },
];

function PaymentList() {
  const { data, isLoading } = useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: async () => {
      const res = await fetch('/api/payments');
      if (!res.ok) throw new Error('Failed to load');
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const filter = useTableFilter(data, PAYMENT_FILTER_CONFIG);

  return (
    <Card>
      <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <FilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          searchPlaceholder="Search payments..."
          dropdowns={[
            { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
            { key: 'token', label: 'Token', options: filter.dropdownOptions.token ?? [] },
            { key: 'chain', label: 'Chain', options: filter.dropdownOptions.chain ?? [] },
            { key: 'erp', label: 'ERP', options: filter.dropdownOptions.erp ?? [] },
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
          onExportCsv={() => exportCsv('payments', EXPORT_COLUMNS, filter.filteredData)}
          onExportPdf={() => exportPdf('payments', 'Payment History', EXPORT_COLUMNS, filter.filteredData, 'landscape')}
        />
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>To</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>ERP</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <CardSpinner />
                </TableCell>
              </TableRow>
            ) : filter.pagedData.length ? (
              filter.pagedData.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-sm">{truncateAddress(p.to_address, 6)}</TableCell>
                  <TableCell>
                    <span className="font-semibold">{formatCurrency(p.amount)}</span>
                  </TableCell>
                  <TableCell><Badge variant="outline">{p.token}</Badge></TableCell>
                  <TableCell><Badge variant={p.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(p.chain)}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLORS[p.status] as any}>{capitalize(p.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.erp_config ? (
                      <span title={p.erp_config.label}>
                        {p.erp_config.provider.toUpperCase()}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {p.scheduled_for ? formatDateTime(p.scheduled_for) : 'Immediate'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateTime(p.created_at)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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

export default function PaymentsPage() {
  return (
    <>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SendPaymentForm />
          <SchedulePaymentForm />
        </div>
        <PaymentList />
      </div>
    </>
  );
}
