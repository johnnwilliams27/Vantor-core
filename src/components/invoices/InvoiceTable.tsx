'use client';
import { useState } from 'react';
import { useInvoices, useSyncInvoices } from '@/hooks/useInvoices';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { FilterBar } from '@/components/ui/filter-bar';
import { TablePagination } from '@/components/ui/table-pagination';
import { useTableFilter } from '@/hooks/useTableFilter';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/utils';
import { exportCsv, exportPdf } from '@/lib/export';
import type { ExportColumn } from '@/lib/export';
import { RefreshCw, Loader2, CreditCard, Plus } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { Invoice, InvoiceStatus } from '@/types/database';
import { useERPStore } from '@/store/erpStore';
import { useToast } from '@/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { DateTimePicker } from '@/components/ui/datetime-picker';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'USDC', 'USDT'] as const;
const STABLECOINS = ['USDC', 'USDT'];

const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1, 'Required'),
  vendorName: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  currency: z.string().min(1, 'Select currency'),
  chain: z.enum(['ethereum', 'solana']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  destinationAddress: z.string().max(200).optional(),
});

type CreateInvoiceForm = z.infer<typeof createInvoiceSchema>;

const STATUS_VARIANTS: Record<InvoiceStatus, 'default' | 'success' | 'warning' | 'destructive' | 'secondary'> = {
  unpaid: 'warning',
  paid: 'success',
  partially_paid: 'info' as any,
  overdue: 'destructive',
  cancelled: 'secondary',
};

function sourceLabel(inv: Invoice): string {
  if (inv.erp_config?.provider) {
    return inv.erp_config.label || inv.erp_config.provider.toUpperCase();
  }
  if (inv.source === 'erp') return 'ERP';
  return 'Manual';
}

function isStablecoin(currency: string): boolean {
  return ['USDC', 'USDT'].includes(currency);
}

const FILTER_CONFIG = {
  searchFields: [
    'invoice_number' as const,
    (item: Invoice) => item.vendor?.name ?? item.vendor_name ?? '',
    (item: Invoice) => item.description ?? '',
  ],
  dropdowns: [
    { key: 'status', accessor: (item: Invoice) => item.status },
    { key: 'currency', accessor: (item: Invoice) => item.currency ?? item.token ?? '' },
    { key: 'source', accessor: (item: Invoice) => sourceLabel(item) },
  ],
  dateField: (item: Invoice) => item.due_date,
};

const EXPORT_COLUMNS: ExportColumn<Invoice>[] = [
  { header: 'Invoice #', accessor: (r) => r.invoice_number },
  { header: 'Vendor', accessor: (r) => r.vendor?.name ?? r.vendor_name ?? '' },
  { header: 'Amount', accessor: (r) => formatCurrency(r.amount) },
  { header: 'Currency', accessor: (r) => r.currency ?? r.token ?? '' },
  { header: 'Chain', accessor: (r) => r.chain ? capitalize(r.chain) : '' },
  { header: 'Source', accessor: (r) => sourceLabel(r) },
  { header: 'Status', accessor: (r) => capitalize(r.status) },
  { header: 'Due Date', accessor: (r) => r.due_date ? formatDateTime(r.due_date) : '' },
];

export function InvoiceTable() {
  const { data: invoices, isLoading } = useInvoices();
  const { activeConfigId } = useERPStore();
  const { mutateAsync: syncInvoices, isPending: syncing } = useSyncInvoices(activeConfigId ?? '');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const {
    register: registerCreate,
    handleSubmit: handleCreateSubmit,
    watch: watchCreate,
    reset: resetCreate,
    setValue: setValueCreate,
    formState: { errors: createErrors, isSubmitting: creating },
  } = useForm<CreateInvoiceForm>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: { currency: 'USD' },
  });

  const selectedCurrency = watchCreate('currency');
  const isStablecoinCurrency = STABLECOINS.includes(selectedCurrency);

  const onCreateInvoice = async (data: CreateInvoiceForm) => {
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          token: isStablecoinCurrency ? data.currency : undefined,
          chain: isStablecoinCurrency ? data.chain : undefined,
          vendorName: data.vendorName || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Invoice created', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      resetCreate();
      setShowCreate(false);
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

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

  const canPay = (inv: Invoice) => inv.status === 'unpaid' || inv.status === 'overdue';

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Invoices</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || !activeConfigId}>
              {syncing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing…</> : <><RefreshCw className="mr-2 h-4 w-4" />Sync from ERP</>}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1 h-4 w-4" />Add Invoice
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
      <FilterBar
        search={filter.search}
        onSearchChange={filter.setSearch}
        searchPlaceholder="Search invoices..."
        dropdowns={[
          { key: 'status', label: 'Status', options: filter.dropdownOptions.status ?? [] },
          { key: 'currency', label: 'Currency', options: filter.dropdownOptions.currency ?? [] },
          { key: 'source', label: 'Source', options: filter.dropdownOptions.source ?? [] },
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
              <TableHead>Currency</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9}>
                  <CardSpinner />
                </TableCell>
              </TableRow>
            ) : filter.pagedData.length ? (
              filter.pagedData.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedInvoice(inv)}
                >
                  <TableCell className="text-sm">{inv.invoice_number}</TableCell>
                  <TableCell className="text-sm">{inv.vendor?.name ?? inv.vendor_name ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    <span className="font-semibold">{formatCurrency(inv.amount)}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="outline">{inv.currency ?? inv.token}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {inv.chain ? (
                      <Badge variant={inv.chain === 'ethereum' ? 'ethereum' : 'solana'}>
                        {capitalize(inv.chain)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="secondary">{sourceLabel(inv)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant={STATUS_VARIANTS[inv.status]}>
                      {capitalize(inv.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {inv.due_date ? formatDateTime(inv.due_date) : '—'}
                  </TableCell>
                  <TableCell>
                    {canPay(inv) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-3 bg-[#19595b] text-white hover:bg-[#134849] border-0"
                        onClick={(e) => { e.stopPropagation(); setPayInvoice(inv); }}
                      >
                        <CreditCard className="h-3 w-3 mr-1" />
                        Pay
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
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

    {/* Pay Invoice Modal */}
    <Dialog open={!!payInvoice} onOpenChange={(o) => !o && setPayInvoice(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pay Invoice</DialogTitle>
        </DialogHeader>
        {payInvoice && (
          <div className="space-y-3">
            <div className="text-sm bg-muted/40 rounded-md p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Invoice</span>
                <span className="font-medium">{payInvoice.invoice_number}</span>
              </div>
              {payInvoice.vendor?.name && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vendor</span>
                  <span className="font-medium">{payInvoice.vendor.name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatCurrency(payInvoice.amount)} {payInvoice.currency ?? payInvoice.token}</span>
              </div>
              {payInvoice.due_date && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Due</span>
                  <span>{formatDateTime(payInvoice.due_date)}</span>
                </div>
              )}
              {payInvoice.destination_address && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Destination</span>
                  <span className="font-mono text-xs">{payInvoice.destination_address}</span>
                </div>
              )}
              {payInvoice.description && (
                <div className="pt-1 border-t border-border/50">
                  <span className="text-muted-foreground text-xs">Description</span>
                  <p className="text-sm mt-0.5">{payInvoice.description}</p>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {isStablecoin(payInvoice.currency ?? payInvoice.token ?? '')
                ? 'This will open the payment form pre-filled with the invoice details.'
                : 'This will open the ramp form to convert and pay this fiat invoice.'}
            </p>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setPayInvoice(null)}>Cancel</Button>
          {payInvoice && (
            isStablecoin(payInvoice.currency ?? payInvoice.token ?? '') ? (
              <Button asChild>
                <Link href={`/payments?invoiceId=${payInvoice.id}&to=${payInvoice.destination_address ?? ''}&amount=${payInvoice.amount}&token=${payInvoice.token ?? 'USDC'}&memo=Invoice ${payInvoice.invoice_number}${payInvoice.vendor?.name ? ` - ${payInvoice.vendor.name}` : ''}`}>
                  Pay with Crypto
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href={`/ramps?invoiceId=${payInvoice.id}&amount=${payInvoice.amount}&currency=${payInvoice.currency ?? 'USD'}&memo=Invoice ${payInvoice.invoice_number}${payInvoice.vendor?.name ? ` - ${payInvoice.vendor.name}` : ''}`}>
                  Pay with Ramp
                </Link>
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Invoice Detail Modal */}
    <Dialog open={!!selectedInvoice} onOpenChange={(o) => !o && setSelectedInvoice(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Invoice Details
            {selectedInvoice && (
              <Badge variant={STATUS_VARIANTS[selectedInvoice.status]}>
                {capitalize(selectedInvoice.status)}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {selectedInvoice && (
          <div className="space-y-3">
            {/* Core info */}
            <div className="bg-muted/40 rounded-md p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Invoice #</span>
                <span className="font-medium">{selectedInvoice.invoice_number}</span>
              </div>
              {(selectedInvoice.vendor?.name || selectedInvoice.vendor_name) && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Vendor</span>
                  <span className="font-medium">{selectedInvoice.vendor?.name ?? selectedInvoice.vendor_name}</span>
                </div>
              )}
              {selectedInvoice.vendor?.email && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Vendor Email</span>
                  <span>{selectedInvoice.vendor.email}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Source</span>
                <span><Badge variant="secondary">{sourceLabel(selectedInvoice)}</Badge></span>
              </div>
              {selectedInvoice.erp_invoice_id && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">ERP Invoice ID</span>
                  <span className="font-mono text-xs">{selectedInvoice.erp_invoice_id}</span>
                </div>
              )}
            </div>

            {/* Financial */}
            <div className="bg-muted/40 rounded-md p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatCurrency(selectedInvoice.amount)} {selectedInvoice.currency ?? selectedInvoice.token}</span>
              </div>
              {selectedInvoice.chain && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Chain</span>
                  <span><Badge variant={selectedInvoice.chain === 'ethereum' ? 'ethereum' : 'solana'}>{capitalize(selectedInvoice.chain)}</Badge></span>
                </div>
              )}
            </div>

            {/* Dates & Terms */}
            <div className="bg-muted/40 rounded-md p-3 space-y-2">
              {selectedInvoice.due_date && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Due Date</span>
                  <span>{formatDateTime(selectedInvoice.due_date)}</span>
                </div>
              )}
              {selectedInvoice.due_date && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Net Terms</span>
                  <span>{Math.ceil((new Date(selectedInvoice.due_date).getTime() - new Date(selectedInvoice.created_at).getTime()) / (1000 * 60 * 60 * 24))} days</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Created</span>
                <span>{formatDateTime(selectedInvoice.created_at)}</span>
              </div>
              {selectedInvoice.paid_at && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Paid</span>
                  <span>{formatDateTime(selectedInvoice.paid_at)}</span>
                </div>
              )}
            </div>

            {/* Destination */}
            {(selectedInvoice.destination_address || selectedInvoice.vendor?.wallet_address) && (
              <div className="bg-muted/40 rounded-md p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Destination</span>
                  <span className="font-mono text-xs text-right max-w-[200px] break-all">
                    {selectedInvoice.destination_address || selectedInvoice.vendor?.wallet_address}
                  </span>
                </div>
              </div>
            )}

            {/* Description / Memo */}
            {selectedInvoice.description && (
              <div className="border-l-2 border-[#19595b] pl-3 text-sm text-muted-foreground">
                {selectedInvoice.description}
              </div>
            )}

            {/* Pay button */}
            {canPay(selectedInvoice) && (
              <Button
                className="w-full"
                onClick={() => { setSelectedInvoice(null); setPayInvoice(selectedInvoice); }}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Pay Invoice
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* Create Invoice Dialog */}
    <Dialog open={showCreate} onOpenChange={setShowCreate}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Invoice</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreateSubmit(onCreateInvoice)} className="space-y-4">
          <div className="space-y-2">
            <Label>Invoice Number</Label>
            <Input placeholder="INV-001" {...registerCreate('invoiceNumber')} />
            {createErrors.invoiceNumber && <p className="text-xs text-red-500">{createErrors.invoiceNumber.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Vendor <span className="text-muted-foreground">(optional)</span></Label>
            <Input placeholder="Vendor or company name" {...registerCreate('vendorName')} />
          </div>

          <div className="space-y-2">
            <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
            <Input placeholder="What is this invoice for?" {...registerCreate('description')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="1000.00" {...registerCreate('amount')} />
              {createErrors.amount && <p className="text-xs text-red-500">{createErrors.amount.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select {...registerCreate('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </div>
          </div>

          {isStablecoinCurrency && (
            <div className="space-y-2">
              <Label>Chain</Label>
              <Select {...registerCreate('chain')}>
                <option value="">Select chain…</option>
                <option value="ethereum">Ethereum</option>
                <option value="solana">Solana</option>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Due Date <span className="text-muted-foreground">(optional)</span></Label>
            <DateTimePicker
              value={watchCreate('dueDate') ? `${watchCreate('dueDate')}T00:00` : ''}
              onChange={(v) => setValueCreate('dueDate', v ? v.split('T')[0] : undefined)}
              placeholder="Select due date"
            />
          </div>

          <div className="space-y-2">
            <Label>Destination Address <span className="text-muted-foreground">(optional)</span></Label>
            <Input placeholder="Wallet address or bank account reference" {...registerCreate('destinationAddress')} />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create Invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
