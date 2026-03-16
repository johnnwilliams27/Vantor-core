import { InvoiceTable } from '@/components/invoices/InvoiceTable';
import { ObligationsPanel } from '@/components/treasury/ObligationsPanel';

export const metadata = { title: 'Invoices – Vantor' };

export default function InvoicesPage() {
  return (
    <div className="space-y-6">
      <ObligationsPanel />
      <InvoiceTable />
    </div>
  );
}
