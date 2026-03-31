'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CreditCard } from 'lucide-react';
import Link from 'next/link';

/**
 * Blocks access to the app when the subscription is past_due.
 * Only allows access to billing settings so the user can update their payment method.
 */
export function PaymentFailedGate() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  // Check subscription status from the API for real-time accuracy
  const { data: sub } = useQuery({
    queryKey: ['billing-subscription-status'],
    queryFn: () => fetch('/api/billing/subscription').then(r => r.json()),
    enabled: !!session?.user?.enterprise_id && session.user.subscription_status === 'past_due',
    refetchInterval: 30000, // Re-check every 30s in case payment is resolved
  });

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Don't gate if not past_due or if on billing page
  const isPastDue = session?.user?.subscription_status === 'past_due';
  const isOnBillingPage = pathname?.startsWith('/settings/billing');

  if (!isPastDue || isOnBillingPage) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-400 ${
        mounted ? 'bg-black/50 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-0'
      }`}
    >
      <div
        className={`bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transition-all duration-500 ${
          mounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-6'
        }`}
      >
        {/* Header */}
        <div className="bg-red-600/90 px-6 py-5 relative overflow-hidden">
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Payment Failed</h2>
              <p className="text-xs text-white/60">Your account access is restricted</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Your most recent payment was unsuccessful. Please update your payment method to restore full access to your account.
          </p>

          <div className="rounded-lg bg-muted/50 px-4 py-3 mb-5">
            <p className="text-xs text-muted-foreground">
              While your payment is past due, your data is safe and your integrations remain connected.
              Resolve the payment to regain access.
            </p>
          </div>

          <Link
            href="/settings/billing?tab=payment"
            className="flex items-center justify-center gap-2 w-full px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
          >
            <CreditCard className="w-4 h-4" />
            Update Payment Method
          </Link>
        </div>
      </div>
    </div>
  );
}
