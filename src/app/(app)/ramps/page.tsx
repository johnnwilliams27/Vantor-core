'use client';
import { RampForm } from '@/components/banking/RampForm';
import { FiatTransactionTable } from '@/components/banking/FiatTransactionTable';

export default function RampsPage() {
  return (
    <>
      <div className="space-y-6">
        <RampForm />
        <FiatTransactionTable />
      </div>
    </>
  );
}
