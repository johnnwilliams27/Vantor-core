'use client';

import { useState } from 'react';
import { TabNav } from '@/components/ui/tab-nav';
import { PlanTab } from '@/components/billing/PlanTab';
import { UsageTab } from '@/components/billing/UsageTab';
import { InvoicesTab } from '@/components/billing/InvoicesTab';
import { PaymentMethodTab } from '@/components/billing/PaymentMethodTab';

type BillingTab = 'plan' | 'usage' | 'invoices' | 'payment';

const TABS = [
  { value: 'plan' as const, label: 'Plan' },
  { value: 'usage' as const, label: 'Usage' },
  { value: 'invoices' as const, label: 'Invoices' },
  { value: 'payment' as const, label: 'Payment Method' },
];

export default function BillingSettingsPage() {
  const [activeTab, setActiveTab] = useState<BillingTab>('plan');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your subscription, view usage, and update payment details.
        </p>
      </div>

      <TabNav tabs={TABS} value={activeTab} onChange={setActiveTab} />

      {activeTab === 'plan' && <PlanTab />}
      {activeTab === 'usage' && <UsageTab />}
      {activeTab === 'invoices' && <InvoicesTab />}
      {activeTab === 'payment' && <PaymentMethodTab />}
    </div>
  );
}
