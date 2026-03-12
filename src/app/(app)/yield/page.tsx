import { AppShell } from '@/components/layout/AppShell';
import { YieldPageClient } from '@/components/yield/YieldPageClient';

export const metadata = { title: 'Yield – Vantor' };

export default function YieldPage() {
  return (
    <AppShell title="Yield">
      <YieldPageClient />
    </AppShell>
  );
}
