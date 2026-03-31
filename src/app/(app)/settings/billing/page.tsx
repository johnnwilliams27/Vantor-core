'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { TabNav } from '@/components/ui/tab-nav';
import { PlanTab } from '@/components/billing/PlanTab';
import { UsageTab } from '@/components/billing/UsageTab';
import { InvoicesTab } from '@/components/billing/InvoicesTab';
import { PaymentMethodTab } from '@/components/billing/PaymentMethodTab';
import { useSession } from 'next-auth/react';

type BillingTab = 'plan' | 'usage' | 'invoices' | 'payment';

const TABS = [
  { value: 'plan' as const, label: 'Plan' },
  { value: 'usage' as const, label: 'Usage' },
  { value: 'invoices' as const, label: 'Invoices' },
  { value: 'payment' as const, label: 'Payment Method' },
];

export default function BillingSettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { update: updateSession } = useSession();
  const [activeTab, setActiveTab] = useState<BillingTab>('plan');
  const [banner, setBanner] = useState<{ type: 'success' | 'cancelled'; message: string } | null>(null);

  useEffect(() => {
    const upgrade = searchParams.get('upgrade');
    if (upgrade === 'success') {
      // Sync subscription from Stripe (fallback when webhook hasn't fired yet)
      // Then switch to live mode so user sees their live (empty) dashboard
      fetch('/api/billing/sync', { method: 'POST' })
        .then(() => fetch('/api/test-mode/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false }),
        }))
        .then(() => updateSession())
        .then(() => {
          setBanner({ type: 'success', message: 'Upgrade successful! Your new plan is now active. You are now in live mode.' });
          router.replace('/settings/billing');
        });
    } else if (upgrade === 'cancelled') {
      setBanner({ type: 'cancelled', message: 'Upgrade cancelled. You can try again anytime.' });
      router.replace('/settings/billing');
    }
  }, [searchParams, router, updateSession]);

  // Auto-dismiss banner
  useEffect(() => {
    if (banner) {
      const t = setTimeout(() => setBanner(null), 5000);
      return () => clearTimeout(t);
    }
  }, [banner]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your subscription, view usage, and update payment details.
        </p>
      </div>

      {banner && (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-medium animate-[fadeSlideUp_0.3s_ease-out] ${
            banner.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-500'
              : 'bg-amber-500/10 border border-amber-500/30 text-amber-500'
          }`}
        >
          {banner.message}
        </div>
      )}

      <TabNav tabs={TABS} value={activeTab} onChange={setActiveTab} />

      {activeTab === 'plan' && <PlanTab />}
      {activeTab === 'usage' && <UsageTab />}
      {activeTab === 'invoices' && <InvoicesTab />}
      {activeTab === 'payment' && <PaymentMethodTab />}
    </div>
  );
}
