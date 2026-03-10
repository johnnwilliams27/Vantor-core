import { AppShell } from '@/components/layout/AppShell';
import { CompliancePageClient } from '@/components/compliance/CompliancePageClient';

export const metadata = { title: 'Compliance – Vantor' };

export default function CompliancePage() {
  return (
    <AppShell title="Compliance">
      <CompliancePageClient />
    </AppShell>
  );
}
