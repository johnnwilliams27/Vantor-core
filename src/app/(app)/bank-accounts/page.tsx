'use client';
import { AppShell } from '@/components/layout/AppShell';
import { BankAccountsTab } from '@/components/banking/BankAccountsTab';

export default function BankAccountsPage() {
  return (
    <AppShell title="Bank Accounts">
      <BankAccountsTab plaidConfigured={false} />
    </AppShell>
  );
}
