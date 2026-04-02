'use client';
import { RampForm } from '@/components/banking/RampForm';
import { ScheduleRampForm } from '@/components/scheduled/ScheduleRampForm';
import { FiatTransactionTable } from '@/components/banking/FiatTransactionTable';

export default function RampsPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RampForm />
        <ScheduleRampForm />
      </div>
      <FiatTransactionTable />
    </div>
  );
}
