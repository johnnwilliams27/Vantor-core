import { AppShell } from '@/components/layout/AppShell';
import { TreasuryPageClient } from '@/components/treasury/TreasuryPageClient';

export const metadata = { title: 'Treasury AI – Vantor' };

export default function TreasuryPage() {
  return (
    <AppShell title="Treasury AI">
      <TreasuryPageClient />
    </AppShell>
  );
}
