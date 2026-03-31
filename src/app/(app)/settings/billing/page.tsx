'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { TabNav } from '@/components/ui/tab-nav';
import { PlanTab } from '@/components/billing/PlanTab';
import { UsageTab } from '@/components/billing/UsageTab';
import { InvoicesTab } from '@/components/billing/InvoicesTab';
import { PaymentMethodTab } from '@/components/billing/PaymentMethodTab';
import { ActivatingPlanModal } from '@/components/billing/ActivatingPlanModal';
import { useSession } from 'next-auth/react';
import { useTestMode } from '@/hooks/useTestMode';

type BillingTab = 'plan' | 'usage' | 'invoices' | 'payment';

const TABS = [
  { value: 'plan' as const, label: 'Plan' },
  { value: 'usage' as const, label: 'Usage' },
  { value: 'invoices' as const, label: 'Invoices' },
  { value: 'payment' as const, label: 'Payment Method' },
];

export default function BillingSettingsPage() {
  return (
    <Suspense>
      <BillingSettingsContent />
    </Suspense>
  );
}

function BillingSettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { update: updateSession } = useSession();
  const { toggleTestMode } = useTestMode();
  const [activeTab, setActiveTab] = useState<BillingTab>('plan');
  const [banner, setBanner] = useState<{ type: 'success' | 'cancelled'; message: string } | null>(null);
  const [activatingStatus, setActivatingStatus] = useState<'syncing' | 'done' | 'error' | null>(null);

  useEffect(() => {
    const upgrade = searchParams.get('upgrade');
    if (upgrade === 'success' && !activatingStatus) {
      setActivatingStatus('syncing');
      router.replace('/settings/billing');

      const syncWithRetry = async (attempts = 3): Promise<boolean> => {
        try {
          const res = await fetch('/api/billing/sync', { method: 'POST' });
          const data = await res.json().catch(() => ({}));
          if (data.synced) return true;
          if (attempts > 1) {
            await new Promise(r => setTimeout(r, 2000));
            return syncWithRetry(attempts - 1);
          }
          return false;
        } catch {
          if (attempts > 1) {
            await new Promise(r => setTimeout(r, 2000));
            return syncWithRetry(attempts - 1);
          }
          return false;
        }
      };

      (async () => {
        try {
          const synced = await syncWithRetry();
          if (!synced) {
            setActivatingStatus('error');
            return;
          }
          // Disable test mode — use direct fetch to avoid slow refetchQueries blocking
          await fetch('/api/test-mode/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
          });
          await updateSession();
          setActivatingStatus('done');
          setTimeout(() => {
            setActivatingStatus(null);
            setBanner({ type: 'success', message: 'Upgrade successful! Your new plan is now active.' });
          }, 1500);
        } catch {
          setActivatingStatus('error');
        }
      })();
    } else if (upgrade === 'cancelled') {
      setBanner({ type: 'cancelled', message: 'Upgrade cancelled. You can try again anytime.' });
      router.replace('/settings/billing');
    }
  }, [searchParams, router, updateSession, activatingStatus]);

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

      {activatingStatus && <ActivatingPlanModal status={activatingStatus} />}

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
