'use client';
import { useInvoices, useSyncInvoices } from '@/hooks/useInvoices';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import { RefreshCw, Loader2 } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';
import type { Invoice, InvoiceStatus } from '@/types/database';
import { useERPStore } from '@/store/erpStore';
import { useToast } from '@/components/ui/toast';

const STATUS_VARIANTS: Record<InvoiceStatus, 'default' | 'success' | 'warning' | 'destructive' | 'secondary'> = {
  unpaid: 'warning',
  paid: 'success',
  partially_paid: 'info' as any,
  overdue: 'destructive',
  cancelled: 'secondary',
};

const FILTER_CONFIG = {
  searchFields: [
    'invoice_number' as const,
    (item: Invoice) => item.vendor?.name ?? '',
    (item: Invoice) => item.description ?? '',
  ],
  dropdowns: [
    { key: 'status', accessor: (item: Invoice) => item.status },
    { key: 'token', accessor: (item: Invoice) => item.token },
    { key: 'chain', accessor: (item: Invoice) => item.chain },
  ],
  dateField: (item: Invoice) => item.due_date,
};

const EXPORT_COLUMNS: ExportColumn<Invoice>[] = [
  { header: 'Invoice #', accessor: (r) => r.invoice_number },
  { header: 'Vendor', accessor: (r) => r.vendor?.name ?? '' },
  { header: 'Amount', accessor: (r) => formatCurrency(r.amount) },
  { header: 'Token', accessor: (r) => r.token },
  { header: 'Chain', accessor: (r) => capitalize(r.chain) },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
  { header: 'Due Date', accessor: (r) => r.due_date ? formatDateTime(r.due_date) : '' },
];

export function InvoiceTable() {
  const { data: invoices, isLoading } = useInvoices();
  const { activeConfigId } = useERPStore();
  const { mutateAsync: syncInvoices, isPending: syncing } = useSyncInvoices(activeConfigId ?? '');
  const { toast } = useToast();

  const filter = useTableFilter(invoices, FILTER_CONFIG);

  const handleSync = async () => {
    if (!activeConfigId) {
      toast({ title: 'No ERP configured', description: 'Set up an ERP connection first', variant: 'destructive' });
      return;
    }
    try {
      const { data } = await syncInvoices();
      toast({ title: 'Sync complete', description: `${data?.synced ?? 0} invoices synced`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Sync failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Invoices</CardTitle>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || !activeConfigId}>
            {syncing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing…</> : <><RefreshCw className="mr-2 h-4 w-4" />Sync from ERP</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
      <FilterBar
        search={filter.search}
        onSearchChange={filter.setSearch}
        searchPlaceholder="Search invoices..."
        dropdowns={[
          { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
          { key: 'token', label: 'Token', options: filter.dropdownOptions.token ?? [] },
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
        onExportCsv={() => exportCsv('invoices', EXPORT_COLUMNS, filter.filteredData)}
        onExportPdf={() => exportPdf('invoices', 'Invoices', EXPORT_COLUMNS, filter.filteredData)}
      />

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due Date</TableHead>
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
              filter.pagedData.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-sm">{inv.invoice_number}</TableCell>
                  <TableCell className="text-sm">{inv.vendor?.name ?? '—'}</TableCell>
                  <TableCell className="font-semibold">{formatCurrency(inv.amount)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{inv.token}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={inv.chain === 'ethereum' ? 'ethereum' : 'solana'}>
                      {capitalize(inv.chain)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[inv.status]}>
                      {capitalize(inv.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {inv.due_date ? formatDateTime(inv.due_date) : '—'}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-400 py-8">
                  {filter.activeFilterCount > 0 ? 'No matching invoices.' : 'No invoices. Sync from ERP or create manually.'}
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
