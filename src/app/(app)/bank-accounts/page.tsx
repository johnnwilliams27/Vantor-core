'use client';
import { BankAccountsTab } from '@/components/banking/BankAccountsTab';

export default function BankAccountsPage() {
  return (
    <>
      <BankAccountsTab plaidConfigured={false} />
    </>
  );
}
