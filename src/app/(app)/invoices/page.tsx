import { AppShell } from '@/components/layout/AppShell';
import { InvoiceTable } from '@/components/invoices/InvoiceTable';

export const metadata = { title: 'Invoices – Vantor' };

export default function InvoicesPage() {
  return (
    <AppShell title="Invoices">
      <InvoiceTable />
    </AppShell>
  );
}
