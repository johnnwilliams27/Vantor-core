import { InvoiceTable } from '@/components/invoices/InvoiceTable';

export const metadata = { title: 'Invoices – Vantor' };

export default function InvoicesPage() {
  return (
    <div className="space-y-6">
      <InvoiceTable />
    </div>
  );
}
