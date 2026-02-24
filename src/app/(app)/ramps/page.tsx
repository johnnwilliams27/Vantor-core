'use client';
import { AppShell } from '@/components/layout/AppShell';
import { RampForm } from '@/components/banking/RampForm';
import { FiatTransactionTable } from '@/components/banking/FiatTransactionTable';

export default function RampsPage() {
  return (
    <AppShell title="Ramps">
      <div className="space-y-6 max-w-3xl">
        <RampForm />
        <FiatTransactionTable />
      </div>
    </AppShell>
  );
}
