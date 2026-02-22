import { AppShell } from '@/components/layout/AppShell';
import { AuditTable } from '@/components/audit/AuditTable';

export const metadata = { title: 'Audit Trail – Vantor' };

export default function AuditPage() {
  return (
    <AppShell title="Audit Trail">
      <AuditTable />
    </AppShell>
  );
}
