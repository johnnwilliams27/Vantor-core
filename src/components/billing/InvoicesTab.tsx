'use client';

import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { exportCsv } from '@/lib/export/csv';
import type { ExportColumn } from '@/lib/export';
import { Skeleton } from '@/components/ui/spinner';

interface InvoiceRow {
  period: string;
  amount: string;
  status: string;
  date: string;
}

const CSV_COLUMNS: ExportColumn<InvoiceRow>[] = [
  { header: 'Period', accessor: (row) => row.period },
  { header: 'Amount', accessor: (row) => row.amount },
  { header: 'Status', accessor: (row) => row.status },
  { header: 'Date', accessor: (row) => row.date },
];

export function InvoicesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () => fetch('/api/billing/invoices').then(r => r.json()),
  });

  if (isLoading) {
    return <InvoicesTabSkeleton />;
  }

  const invoices = data?.invoices || [];

  const handleCsvExport = () => {
    if (!invoices.length) return;
    const rows: InvoiceRow[] = invoices.map((inv: any) => ({
      period: `${new Date(inv.period_start * 1000).toLocaleDateString()} - ${new Date(inv.period_end * 1000).toLocaleDateString()}`,
      amount: (inv.amount_paid / 100).toFixed(2),
      status: inv.status,
      date: new Date(inv.created * 1000).toLocaleDateString(),
    }));
    exportCsv('vantor-invoices', CSV_COLUMNS, rows);
  };

  if (invoices.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No invoices yet. Invoices will appear here after your first billing cycle.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={handleCsvExport}
          className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
        >
          Export CSV
        </button>
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 text-sm font-medium text-muted-foreground">Period</th>
              <th className="text-left p-3 text-sm font-medium text-muted-foreground">Amount</th>
              <th className="text-left p-3 text-sm font-medium text-muted-foreground">Status</th>
              <th className="text-left p-3 text-sm font-medium text-muted-foreground">Date</th>
              <th className="text-right p-3 text-sm font-medium text-muted-foreground">PDF</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv: any) => (
              <tr key={inv.id} className="border-t border-border">
                <td className="p-3 text-sm">
                  {new Date(inv.period_start * 1000).toLocaleDateString()} —{' '}
                  {new Date(inv.period_end * 1000).toLocaleDateString()}
                </td>
                <td className="p-3 text-sm font-medium tabular-nums">
                  ${(inv.amount_paid / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
                <td className="p-3 text-sm">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    inv.status === 'paid' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                  }`}>
                    {inv.status}
                  </span>
                </td>
                <td className="p-3 text-sm text-muted-foreground">
                  {new Date(inv.created * 1000).toLocaleDateString()}
                </td>
                <td className="p-3 text-right">
                  {inv.invoice_pdf && (
                    <a
                      href={inv.invoice_pdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:text-primary/80 text-sm"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoicesTabSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading invoices">
      <div className="flex justify-end">
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center gap-4 px-3 py-3 bg-muted/50 border-b border-border">
          {['Period', 'Amount', 'Status', 'Date', 'PDF'].map((_, i) => (
            <Skeleton key={i} className="h-3.5 flex-1" style={{ maxWidth: i === 4 ? '40px' : undefined }} />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-3 py-3.5 border-t border-border">
            {Array.from({ length: 5 }).map((_, c) => (
              <Skeleton key={c} className="h-3.5 flex-1" style={{ maxWidth: c === 4 ? '40px' : c === 2 ? '80px' : undefined }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
